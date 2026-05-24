#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-session-delivery-target-binding-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp

mkdir -p "$TMP_DIR/workspace/html"

cat > "$TMP_DIR/workspace/html/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Session Delivery Target Binding</title>
  </head>
  <body>
    <main>
      <h1>BlockFork Session Delivery Target Binding</h1>
      <p>Used to verify session-scoped Telegram delivery target persistence and notification rendering.</p>
    </main>
  </body>
</html>
HTML

node - "$REPO_ROOT" "$TMP_DIR" <<'NODE'
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const fetchImpl = global.fetch || require('node-fetch');
const repoRoot = process.argv[2];
const tmpDir = process.argv[3];
process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = path.join(tmpDir, 'workspace');

const runtime = require(path.join(repoRoot, 'server.js'));
const {
  app,
  TASK_STATES,
  EXECUTION_STATES,
  TASK_PROGRESS_CATEGORIES,
  TASK_NOTIFICATION_DELIVERY_STATES,
  createSessionRecord,
  getOrCreateLiveKeyForSession,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  prepareArtifactBindingForExecution,
  validateArtifactHonestyOrError,
  getStoredSessionDeliveryTargetBySessionId,
  getTaskNotificationsByTaskId,
} = runtime;

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function jsonRequest(baseUrl, pathName, options = {}) {
  const response = await fetchImpl(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'content-type': 'application/json',
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${pathName}: ${JSON.stringify(body || {})}`);
  }
  return body;
}

async function buildTask(sessionId, label) {
  const requestId = `bind_req_${label}_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `bind_task_${label}_${crypto.randomUUID()}`,
    objectiveText: 'Create a premium landing page from this source page.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `bind_exec_${label}_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await transitionTask(task.task_id, TASK_STATES.ACKNOWLEDGED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
    message: 'Task accepted. I am starting the work now.',
  });
  await transitionTask(task.task_id, TASK_STATES.PLANNED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_planned',
    message: 'I have locked the plan and am moving into execution.',
  });
  await transitionExecution(execution.execution_id, EXECUTION_STATES.QUEUED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await transitionExecution(execution.execution_id, EXECUTION_STATES.RUNNING, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_running',
  });

  const artifactPath = path.join(tmpDir, 'workspace', 'html', `index-${label}.html`);
  fs.writeFileSync(artifactPath, `<!doctype html><html><body><main><h1>${label}</h1></main></body></html>`);
  const binding = await prepareArtifactBindingForExecution(execution.execution_id, {
    metadata: {
      blockfork_artifact_contract: {
        requested: true,
        evidence: {
          path: artifactPath,
          delivery_requested: false,
          delivery_confirmed: false,
        },
      },
    },
  }, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    timestamp: new Date().toISOString(),
  });
  assert(binding.ok, `Artifact binding failed for ${label}: ${binding.reason || 'unknown'}`);

  const validation = await validateArtifactHonestyOrError({
    metadata: {
      blockfork_artifact_contract: {
        requested: true,
        evidence: {
          path: artifactPath,
          delivery_requested: false,
          delivery_confirmed: false,
        },
      },
    },
  }, 'Created the landing page file and verified the result.', {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    meaningfulOutputStarted: true,
  });
  assert(validation === null, `Unexpected artifact honesty failure for ${label}: ${validation?.message || 'unknown'}`);

  await transitionExecution(execution.execution_id, EXECUTION_STATES.COMPLETED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });

  await transitionTask(task.task_id, TASK_STATES.COMPLETED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_completed',
    message: 'The task is complete.',
  });

  return { task, execution };
}

(async () => {
  const session = await createSessionRecord({
    user_id: `bind_${Date.now()}`,
  });
  const liveKey = await getOrCreateLiveKeyForSession(session, {
    user_id: session.user_id || null,
  });

  await withServer(async (baseUrl) => {
    const headers = {
      authorization: `Bearer ${liveKey.key}`,
    };

    const first = await buildTask(session.session_id, 'first');
    const beforeBind = await jsonRequest(baseUrl, '/v1/task-notifications/pull', {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 20 }),
    });
    assert(Number(beforeBind.count || 0) === 0, `Expected no notifications before bind, found ${beforeBind.count || 0}`);
    assert(Array.isArray(beforeBind.data) && beforeBind.data.length === 0, 'Notifications should be withheld before binding a delivery target');
    const pendingFirst = await getTaskNotificationsByTaskId(first.task.task_id);
    assert(pendingFirst.length > 0, 'Pending notifications should exist before the bind');

    const targetA = {
      delivery_target: {
        channel: 'telegram',
        chat_id: 'telegram-chat-a',
        thread_id: null,
      },
    };
    const bindA = await jsonRequest(baseUrl, '/v1/session/delivery-target', {
      method: 'PUT',
      headers,
      body: JSON.stringify(targetA),
    });
    assert(bindA.data.session_id === session.session_id, 'Bind response should target the active session');
    assert(bindA.data.delivery_target.channel === 'telegram', 'Bind response channel mismatch');
    assert(bindA.data.delivery_target.chat_id === 'telegram-chat-a', 'Bind response chat_id mismatch');
    assert(bindA.data.delivery_target.thread_id === null, 'Bind response thread_id should be null');

    const sameBind = await jsonRequest(baseUrl, '/v1/session/delivery-target', {
      method: 'PUT',
      headers,
      body: JSON.stringify(targetA),
    });
    assert(sameBind.data.delivery_target.chat_id === 'telegram-chat-a', 'Idempotent bind should preserve chat_id');

    const afterBind = await jsonRequest(baseUrl, '/v1/task-notifications/pull', {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 20 }),
    });
    assert(Number(afterBind.count || 0) > 0, 'Notifications should be returned once a delivery target is bound');
    afterBind.data.forEach((notification) => {
      assert(notification.delivery_target, 'Pulled notification should include delivery_target');
      assert(notification.delivery_target.channel === 'telegram', 'Pulled delivery target channel mismatch');
      assert(notification.delivery_target.chat_id === 'telegram-chat-a', 'Pulled delivery target chat_id mismatch');
      assert(notification.delivery_target.thread_id === null, 'Pulled delivery target thread_id mismatch');
      assert(notification.outbound_text && notification.outbound_text.length > 0, 'Pulled notification should include outbound_text');
    });

    const second = await buildTask(session.session_id, 'second');
    const targetB = {
      delivery_target: {
        channel: 'telegram',
        chat_id: 'telegram-chat-b',
        thread_id: 'thread-42',
      },
    };
    const bindB = await jsonRequest(baseUrl, '/v1/session/delivery-target', {
      method: 'PUT',
      headers,
      body: JSON.stringify(targetB),
    });
    assert(bindB.data.delivery_target.chat_id === 'telegram-chat-b', 'Updated bind should change chat_id');
    assert(bindB.data.delivery_target.thread_id === 'thread-42', 'Updated bind should change thread_id');

    const afterUpdate = await jsonRequest(baseUrl, '/v1/task-notifications/pull', {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 20 }),
    });
    assert(Number(afterUpdate.count || 0) > 0, 'Notifications should still be returned after destination update');
    afterUpdate.data.forEach((notification) => {
      assert(notification.delivery_target, 'Updated pull should include delivery_target');
      assert(notification.delivery_target.channel === 'telegram', 'Updated pull channel mismatch');
      assert(notification.delivery_target.chat_id === 'telegram-chat-b', 'Updated pull chat_id mismatch');
      assert(notification.delivery_target.thread_id === 'thread-42', 'Updated pull thread_id mismatch');
    });

    const secondTaskNotifications = await getTaskNotificationsByTaskId(second.task.task_id);
    assert(secondTaskNotifications.length > 0, 'Second task should generate notifications');
  });

  console.log(JSON.stringify({
    status: 'pass',
    session_id: session.session_id,
    delivery_target_bind_path: '/v1/session/delivery-target',
    verified_shapes: [
      'withheld_without_delivery_target',
      'bound_delivery_target_in_pull_response',
      'idempotent_same_target_bind',
      'updated_delivery_target_in_pull_response',
    ],
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
NODE
