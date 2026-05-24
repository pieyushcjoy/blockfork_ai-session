#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-single-real-dispatch-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp
require_cmd chmod

mkdir -p "$TMP_DIR/workspace" "$TMP_DIR/bin"
cp "$REPO_ROOT/server.js" "$TMP_DIR/server.js"
cp "$REPO_ROOT/package.json" "$TMP_DIR/package.json"
ln -s "$REPO_ROOT/node_modules" "$TMP_DIR/node_modules"
mkdir -p "$TMP_DIR/public"

cat > "$TMP_DIR/bin/openclaw" <<'NODE'
#!/usr/bin/env node
const fs = require('fs');

const args = process.argv.slice(2);
const mode = process.env.FAKE_OPENCLAW_MODE || 'real_success';
const capturePath = process.env.FAKE_OPENCLAW_CAPTURE_PATH || '';

function readFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || '' : '';
}

function write(json) {
  process.stdout.write(`${JSON.stringify(json)}\n`);
}

if (capturePath) {
  fs.appendFileSync(capturePath, `${JSON.stringify({ argv: args, mode })}\n`);
}

if (mode === 'failure') {
  console.error('simulated openclaw failure');
  process.exit(17);
}

const target = readFlag('--target');
const threadId = readFlag('--thread-id');
const message = readFlag('--message');

if (mode === 'real_success') {
  write({
    action: 'send',
    channel: 'telegram',
    dryRun: false,
    handledBy: 'plugin',
    payload: {
      ok: true,
      messageId: process.env.FAKE_OPENCLAW_MESSAGE_ID || '358',
      chatId: target,
    },
  });
} else if (mode === 'real_chat_mismatch') {
  write({
    action: 'send',
    channel: 'telegram',
    dryRun: false,
    handledBy: 'plugin',
    payload: {
      ok: true,
      messageId: process.env.FAKE_OPENCLAW_MESSAGE_ID || '359',
      chatId: process.env.FAKE_OPENCLAW_CHAT_ID || '999999',
    },
  });
} else if (mode === 'real_missing_message_id') {
  write({
    action: 'send',
    channel: 'telegram',
    dryRun: false,
    handledBy: 'plugin',
    payload: {
      ok: true,
      chatId: target,
    },
  });
} else {
  write({
    action: 'send',
    channel: 'telegram',
    dryRun: true,
    handledBy: 'core',
    payload: {
      channel: 'telegram',
      to: `telegram:${target}`,
      via: 'direct',
      mediaUrl: null,
      dryRun: true,
      message,
      ...(threadId ? { threadId } : {}),
    },
  });
}
NODE

chmod +x "$TMP_DIR/bin/openclaw"

node - "$REPO_ROOT" "$TMP_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const repoRoot = process.argv[2];
const tmpDir = process.argv[3];
const capturePath = path.join(tmpDir, 'invocations.jsonl');

process.chdir(tmpDir);
process.env.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
process.env.BLOCKFORK_OPENCLAW_CLI_BIN = path.join(tmpDir, 'bin', 'openclaw');
process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = '0';
process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS = '5000';
process.env.FAKE_OPENCLAW_CAPTURE_PATH = capturePath;

const runtime = require(path.join(tmpDir, 'server.js'));
const {
  ensureBillingDb,
  createSessionRecord,
  createLiveKeySessionRecord,
  getOrCreateLiveKeyForSession,
  bindSessionDeliveryTarget,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  TASK_STATES,
  EXECUTION_STATES,
  dispatchTaskNotificationById,
  getTaskNotificationsByTaskId,
  getNotificationDeliveryAttemptByNotificationId,
} = runtime;

async function createTaskWithNotifications(sessionId, label) {
  const requestId = `single_dispatch_req_${label}_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `single_dispatch_task_${label}_${crypto.randomUUID()}`,
    objectiveText: `Create a markdown file named ${label}.md with a concise brief.`,
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `single_dispatch_exec_${label}_${crypto.randomUUID()}`,
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
  await transitionTask(task.task_id, TASK_STATES.TOOL_WORK_STARTED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'tool_work_started',
    message: 'Tool work has started.',
  });
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

function readInvocationCount() {
  if (!fs.existsSync(capturePath)) {
    return 0;
  }
  const raw = fs.readFileSync(capturePath, 'utf8').trim();
  if (!raw) {
    return 0;
  }
  return raw.split('\n').filter(Boolean).length;
}

function readInvocations() {
  if (!fs.existsSync(capturePath)) {
    return [];
  }
  const raw = fs.readFileSync(capturePath, 'utf8').trim();
  if (!raw) {
    return [];
  }
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function createTargetedSession(label, chatId, threadId = null) {
  const session = await createSessionRecord({ user_id: `single_dispatch_${label}_${Date.now()}` });
  const liveKey = await getOrCreateLiveKeyForSession(session, {
    user_id: session.user_id || null,
  });
  await bindSessionDeliveryTarget(session.session_id, {
    delivery_target: {
      channel: 'telegram',
      chat_id: String(chatId),
      thread_id: threadId,
    },
  }, { timestamp: new Date().toISOString() });
  return { session, liveKey };
}

(async () => {
  await ensureBillingDb();

  const targetChatId = '8407120350';

  const successSession = await createTargetedSession('success', targetChatId);
  const successTask = await createTaskWithNotifications(successSession.session.session_id, 'real-success');
  const successNotifications = await getTaskNotificationsByTaskId(successTask.task.task_id);
  assert(successNotifications.length > 0, 'Expected notifications for success case');
  const successNotificationId = successNotifications[0].notification_id;
  const invocationCountBeforeSuccess = readInvocationCount();
  process.env.FAKE_OPENCLAW_MODE = 'real_success';
  process.env.FAKE_OPENCLAW_MESSAGE_ID = '358';
  const successResult = await dispatchTaskNotificationById(successNotificationId, {
    transport: 'openclaw_cli',
    dryRun: false,
    commandPath: process.env.BLOCKFORK_OPENCLAW_CLI_BIN,
    timeoutMs: 5000,
    maxRealSends: 1,
    timestamp: new Date().toISOString(),
  });
  assert(successResult.status === 'delivered', 'Real plugin success should deliver notification');
  assert(successResult.notification && successResult.notification.delivery_state === 'delivered', 'Notification should be delivered on real success');
  assert(successResult.notification.delivered_message_id === '358', 'Delivered message id should be persisted');
  const successAttempt = await getNotificationDeliveryAttemptByNotificationId(successNotificationId);
  assert(successAttempt && successAttempt.success, 'Success attempt should be recorded as successful');
  assert(!successAttempt.dry_run, 'Success attempt should be real-send, not dry-run');
  assert(successAttempt.exit_code === 0, 'Success attempt should have exit code 0');
  assert(String(successAttempt.stdout_json?.payload?.messageId || '') === '358', 'Success stdout JSON should include messageId');
  assert(String(successAttempt.stdout_json?.payload?.chatId || '') === targetChatId, 'Success stdout JSON should include expected chat id');
  assert(readInvocationCount() === invocationCountBeforeSuccess + 1, 'Real success should invoke CLI exactly once');

  const mismatchSession = await createTargetedSession('mismatch', targetChatId);
  const mismatchTask = await createTaskWithNotifications(mismatchSession.session.session_id, 'real-mismatch');
  const mismatchNotificationId = (await getTaskNotificationsByTaskId(mismatchTask.task.task_id))[0].notification_id;
  const invocationCountBeforeMismatch = readInvocationCount();
  process.env.FAKE_OPENCLAW_MODE = 'real_chat_mismatch';
  const mismatchResult = await dispatchTaskNotificationById(mismatchNotificationId, {
    transport: 'openclaw_cli',
    dryRun: false,
    commandPath: process.env.BLOCKFORK_OPENCLAW_CLI_BIN,
    timeoutMs: 5000,
    maxRealSends: 1,
    timestamp: new Date().toISOString(),
  });
  assert(mismatchResult.status === 'failed', 'Chat mismatch should fail');
  assert(mismatchResult.notification && mismatchResult.notification.delivery_state === 'failed', 'Chat mismatch notification should be failed');
  const mismatchAttempt = await getNotificationDeliveryAttemptByNotificationId(mismatchNotificationId);
  assert(mismatchAttempt && !mismatchAttempt.success, 'Mismatch attempt should fail');
  assert(mismatchAttempt.error_code === 'contract_violation', 'Mismatch failure should be a contract violation');
  assert(readInvocationCount() === invocationCountBeforeMismatch + 1, 'Chat mismatch should still invoke CLI exactly once');

  const missingMessageSession = await createTargetedSession('missing', targetChatId);
  const missingTask = await createTaskWithNotifications(missingMessageSession.session.session_id, 'real-missing-message-id');
  const missingNotificationId = (await getTaskNotificationsByTaskId(missingTask.task.task_id))[0].notification_id;
  const invocationCountBeforeMissing = readInvocationCount();
  process.env.FAKE_OPENCLAW_MODE = 'real_missing_message_id';
  const missingResult = await dispatchTaskNotificationById(missingNotificationId, {
    transport: 'openclaw_cli',
    dryRun: false,
    commandPath: process.env.BLOCKFORK_OPENCLAW_CLI_BIN,
    timeoutMs: 5000,
    maxRealSends: 1,
    timestamp: new Date().toISOString(),
  });
  assert(missingResult.status === 'failed', 'Missing messageId should fail');
  assert(missingResult.notification && missingResult.notification.delivery_state === 'failed', 'Missing messageId notification should be failed');
  const missingAttempt = await getNotificationDeliveryAttemptByNotificationId(missingNotificationId);
  assert(missingAttempt && !missingAttempt.success, 'Missing messageId attempt should fail');
  assert(missingAttempt.error_code === 'contract_violation', 'Missing messageId failure should be a contract violation');
  assert(readInvocationCount() === invocationCountBeforeMissing + 1, 'Missing messageId should still invoke CLI exactly once');

  const guardSessionA = await createTargetedSession('guard-a', targetChatId);
  const guardTaskA = await createTaskWithNotifications(guardSessionA.session.session_id, 'guard-a');
  const guardNotificationId = (await getTaskNotificationsByTaskId(guardTaskA.task.task_id))[0].notification_id;
  const guardSessionB = await createTargetedSession('guard-b', targetChatId);
  const guardTaskB = await createTaskWithNotifications(guardSessionB.session.session_id, 'guard-b');
  const guardOtherNotificationId = (await getTaskNotificationsByTaskId(guardTaskB.task.task_id))[0].notification_id;
  const invocationsBeforeGuard = readInvocationCount();
  process.env.FAKE_OPENCLAW_MODE = 'real_success';
  const guardResult = await dispatchTaskNotificationById(guardNotificationId, {
    transport: 'openclaw_cli',
    dryRun: false,
    commandPath: process.env.BLOCKFORK_OPENCLAW_CLI_BIN,
    timeoutMs: 5000,
    maxRealSends: 1,
    timestamp: new Date().toISOString(),
  });
  assert(guardResult.status === 'delivered', 'Guarded single notification should still deliver');
  assert(readInvocationCount() === invocationsBeforeGuard + 1, 'Exact notification dispatch should invoke CLI exactly once');
  const guardOtherNotifications = await getTaskNotificationsByTaskId(guardTaskB.task.task_id);
  const guardOtherTarget = guardOtherNotifications.find((notification) => notification.notification_id === guardOtherNotificationId);
  assert(guardOtherTarget && guardOtherTarget.delivery_state === 'pending', 'Other session notification should remain pending');

  const noTargetSession = await createSessionRecord({ user_id: `single_dispatch_no_target_${Date.now()}` });
  const noTargetTask = await createTaskWithNotifications(noTargetSession.session_id, 'no-target');
  const noTargetNotificationId = (await getTaskNotificationsByTaskId(noTargetTask.task.task_id))[0].notification_id;
  const invocationsBeforeNoTarget = readInvocationCount();
  process.env.FAKE_OPENCLAW_MODE = 'real_success';
  const noTargetResult = await dispatchTaskNotificationById(noTargetNotificationId, {
    transport: 'openclaw_cli',
    dryRun: false,
    commandPath: process.env.BLOCKFORK_OPENCLAW_CLI_BIN,
    timeoutMs: 5000,
    maxRealSends: 1,
    timestamp: new Date().toISOString(),
  });
  assert(noTargetResult.status === 'blocked', 'No-target notification should be blocked');
  assert(noTargetResult.reason_code === 'no_delivery_target', 'No-target notification should explain missing target');
  assert(readInvocationCount() === invocationsBeforeNoTarget, 'No-target dispatch should not invoke CLI');

  const noTargetNotifications = await getTaskNotificationsByTaskId(noTargetTask.task.task_id);
  assert(noTargetNotifications.every((notification) => notification.delivery_state === 'pending'), 'No-target notifications should remain pending');

  console.log(JSON.stringify({
    status: 'pass',
    cases: {
      real_success: {
        notification_id: successNotificationId,
        attempt: successAttempt,
        result: successResult,
      },
      chat_mismatch: {
        notification_id: mismatchNotificationId,
        attempt: mismatchAttempt,
        result: mismatchResult,
      },
      missing_message_id: {
        notification_id: missingNotificationId,
        attempt: missingAttempt,
        result: missingResult,
      },
      guard: {
        notification_id: guardNotificationId,
        other_notification_id: guardOtherNotificationId,
        result: guardResult,
      },
      no_target: {
        notification_id: noTargetNotificationId,
        result: noTargetResult,
      },
    },
    captured_invocations: readInvocations(),
    exact_dispatch_safe: true,
    real_contract_supported: true,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
NODE
