#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-task-notification-delivery-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp

mkdir -p "$TMP_DIR/workspace/html" "$TMP_DIR/workspace/blocked"

cat > "$TMP_DIR/workspace/html/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Notification Delivery Gate</title>
  </head>
  <body>
    <main>
      <h1>BlockFork Notification Delivery Gate</h1>
      <p>This artifact is used to verify the task notification outbox and delivery contract.</p>
    </main>
  </body>
</html>
HTML

node - "$REPO_ROOT" "$TMP_DIR" <<'NODE'
const path = require('path');
const crypto = require('crypto');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const repoRoot = process.argv[2];
const tmpDir = process.argv[3];
process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = path.join(tmpDir, 'workspace');

const runtime = require(path.join(repoRoot, 'server.js'));
const {
  EXECUTION_STATES,
  TASK_STATES,
  TASK_PROGRESS_CATEGORIES,
  TASK_NOTIFICATION_DELIVERY_STATES,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  prepareArtifactBindingForExecution,
  validateArtifactHonestyOrError,
  getTaskNotificationsByTaskId,
  getTaskNotificationById,
  claimTaskNotificationsForSession,
  markTaskNotificationDelivered,
} = runtime;

async function buildCompletedTask() {
  const sessionId = `notify_${Date.now()}_${crypto.randomUUID()}`;
  const requestId = `notify_req_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `notify_task_${crypto.randomUUID()}`,
    objectiveText: 'Create a premium landing page from this source page.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `notify_exec_${crypto.randomUUID()}`,
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

  const artifactPath = path.join(tmpDir, 'workspace', 'html', 'index.html');
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
  assert(binding.ok, `Artifact binding failed: ${binding.reason || 'unknown'}`);

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
  assert(validation === null, `Unexpected artifact honesty failure: ${validation?.message || 'unknown'}`);

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

async function buildBlockedTask() {
  const sessionId = `notify_blocked_${Date.now()}_${crypto.randomUUID()}`;
  const requestId = `notify_blocked_req_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `notify_blocked_task_${crypto.randomUUID()}`,
    objectiveText: 'Create a landing page, but ask me which brand color to use.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `notify_blocked_exec_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await transitionTask(task.task_id, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'missing_user_choice',
    message: 'I am blocked and need your input to continue safely.',
  });

  return { task, execution };
}

(async () => {
  const completed = await buildCompletedTask();
  const notifications = await getTaskNotificationsByTaskId(completed.task.task_id);
  const categories = notifications.map((notification) => notification.notification_kind);
  const expectedCategories = [
    TASK_PROGRESS_CATEGORIES.TASK_ACCEPTED,
    TASK_PROGRESS_CATEGORIES.PLAN_LOCKED,
    TASK_PROGRESS_CATEGORIES.TOOL_WORK_STARTED,
    TASK_PROGRESS_CATEGORIES.ARTIFACT_CREATED,
    TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFICATION_STARTED,
    TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFIED,
    TASK_PROGRESS_CATEGORIES.TASK_COMPLETED,
  ];

  assert(categories.length === expectedCategories.length, `Expected ${expectedCategories.length} notifications, found ${categories.length}`);
  expectedCategories.forEach((category, index) => {
    assert(categories[index] === category, `Notification ${index + 1} should be ${category}, found ${categories[index]}`);
  });

  const acceptedNotification = notifications[0];
  assert(acceptedNotification.delivery_state === TASK_NOTIFICATION_DELIVERY_STATES.PENDING, 'New notifications should begin pending');
  assert(acceptedNotification.payload.task_id === completed.task.task_id, 'Notification payload should include task id');
  assert(acceptedNotification.payload.session_id === completed.task.session_id, 'Notification payload should include session id');

  const terminalNotification = notifications.find((notification) => notification.notification_kind === TASK_PROGRESS_CATEGORIES.TASK_COMPLETED);
  assert(terminalNotification, 'Missing task completed notification');
  const terminalView = await runtime.renderTaskNotificationView(terminalNotification.notification_id);
  assert(String(terminalView.outbound_text || '').includes('Task completed'), 'Completed notification should use truthful summary text');
  assert(Array.isArray(terminalView.payload.verified), 'Completed notification should expose verified facts');
  assert(Array.isArray(terminalView.payload.not_verified), 'Completed notification should expose not verified facts');

  const claimed = await claimTaskNotificationsForSession(completed.task.session_id, { limit: 20 });
  assert(claimed.length === expectedCategories.length, `Expected ${expectedCategories.length} claimed notifications, found ${claimed.length}`);
  const claimedAgain = await claimTaskNotificationsForSession(completed.task.session_id, { limit: 20 });
  assert(claimedAgain.length === 0, 'Claimed notifications should not be re-pulled immediately');

  const delivered = await markTaskNotificationDelivered(claimed[0].notification_id, {
    deliveredMessageId: `tg_${crypto.randomUUID()}`,
  });
  assert(delivered, 'Delivered notification update failed');
  assert(delivered.delivery_state === TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Delivered notification should be marked delivered');
  assert(delivered.delivered_message_id, 'Delivered notification should keep delivered message id');

  const deliveredRoundTrip = await getTaskNotificationById(claimed[0].notification_id);
  assert(deliveredRoundTrip.delivery_state === TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Delivered state should persist');

  const blocked = await buildBlockedTask();
  const blockedNotifications = await getTaskNotificationsByTaskId(blocked.task.task_id);
  assert(blockedNotifications.length === 1, `Expected one blocked notification, found ${blockedNotifications.length}`);
  assert(blockedNotifications[0].notification_kind === TASK_PROGRESS_CATEGORIES.BLOCKED_HUMAN_INPUT_REQUIRED, 'Blocked notification category mismatch');
  const blockedView = await runtime.renderTaskNotificationView(blockedNotifications[0].notification_id);
  assert(blockedView.progress_event.decision === 'interrupt_user', 'Blocked notification should interrupt user');
  assert(Number(blockedView.progress_event.requires_user_input || 0) === 1, 'Blocked notification should require user input');
  assert(String(blockedView.outbound_text || '').includes('blocked'), 'Blocked notification should be truthful and concise');

  console.log(JSON.stringify({
    status: 'pass',
    completed_task_id: completed.task.task_id,
    completed_notification_categories: categories,
    claimed_notification_count: claimed.length,
    delivered_notification_id: deliveredRoundTrip.notification_id,
    blocked_task_id: blocked.task.task_id,
    blocked_notification_category: blockedNotifications[0].notification_kind,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
