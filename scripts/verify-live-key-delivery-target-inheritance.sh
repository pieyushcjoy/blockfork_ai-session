#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-live-key-delivery-target-inheritance-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp
require_cmd ln
require_cmd cp

cp "$REPO_ROOT/server.js" "$TMP_DIR/server.js"
ln -s "$REPO_ROOT/node_modules" "$TMP_DIR/node_modules"

mkdir -p "$TMP_DIR/public"
cp "$REPO_ROOT/package.json" "$TMP_DIR/package.json"

node - "$TMP_DIR" <<'NODE'
const path = require('path');
const crypto = require('crypto');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const tmpDir = process.argv[2];
process.chdir(tmpDir);
process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = path.join(tmpDir, 'workspace');

const runtime = require(path.join(tmpDir, 'server.js'));
const {
  ensureBillingDb,
  createSessionRecord,
  createLiveKeySessionRecord,
  getOrCreateLiveKeyForSession,
  loadPersistedLiveKeyByApiKey,
  mintLiveKeyForUser,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  TASK_STATES,
  EXECUTION_STATES,
  getStoredSessionDeliveryTargetBySessionId,
  getStoredLiveKeyDeliveryTargetByLiveKeyId,
  getTaskNotificationsByTaskId,
  bindSessionDeliveryTarget,
  bindLiveKeyDeliveryTarget,
  pullTaskNotificationsForSession,
  markTaskNotificationDelivered,
} = runtime;

async function buildTask(sessionId, label) {
  const requestId = `inherit_req_${label}_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `inherit_task_${label}_${crypto.randomUUID()}`,
    objectiveText: 'Create a concise Markdown product brief.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `inherit_exec_${label}_${crypto.randomUUID()}`,
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

(async () => {
  const db = await ensureBillingDb();

  const sessionA = await createSessionRecord({
    user_id: `inherit_${Date.now()}`,
  });
  const liveKeyA = await getOrCreateLiveKeyForSession(sessionA, {
    user_id: sessionA.user_id || null,
  });

  const bindTargetA = {
    delivery_target: {
      channel: 'telegram',
      chat_id: 'test-chat-123',
      thread_id: null,
    },
  };

  const timestampA = new Date().toISOString();
  const sessionBindA = await bindSessionDeliveryTarget(sessionA.session_id, bindTargetA, {
    timestamp: timestampA,
  });
  assert(sessionBindA, 'Session delivery target should be bound for the active session');
  const liveKeyBindA = await bindLiveKeyDeliveryTarget(liveKeyA.id, bindTargetA, {
    timestamp: timestampA,
  });
  assert(liveKeyBindA, 'Live-key delivery target should be bound for the durable lane');

  const sessionTargetA = await getStoredSessionDeliveryTargetBySessionId(db, sessionA.session_id);
  assert(sessionTargetA, 'Session delivery target should exist after live-key bind');
  assert(sessionTargetA.chat_id === 'test-chat-123', 'Session delivery target chat_id mismatch');

  const liveKeyTargetA = await getStoredLiveKeyDeliveryTargetByLiveKeyId(db, liveKeyA.id);
  assert(liveKeyTargetA, 'Durable live-key delivery target should exist after live-key bind');
  assert(liveKeyTargetA.chat_id === 'test-chat-123', 'Live-key delivery target chat_id mismatch');

  const liveKeyRowA = await loadPersistedLiveKeyByApiKey(liveKeyA.key);
  const sessionB = await createLiveKeySessionRecord(db, liveKeyRowA, sessionA.ttl_selected);
  const sessionTargetB = await getStoredSessionDeliveryTargetBySessionId(db, sessionB.session_id);
  assert(sessionTargetB, 'Fresh live-key session should inherit a materialized session delivery target');
  assert(sessionTargetB.chat_id === 'test-chat-123', 'Inherited session delivery target chat_id mismatch');

  const taskB = await buildTask(sessionB.session_id, 'inherited');
  const beforePullB = await getTaskNotificationsByTaskId(taskB.task.task_id);
  assert(beforePullB.length > 0, 'Inherited-session task should create notifications');

  const pullB = await pullTaskNotificationsForSession(sessionB.session_id, {
    limit: 20,
    timestamp: new Date().toISOString(),
  });
  assert(pullB.length > 0, 'Inherited session should return claimable notifications');
  pullB.forEach((notification) => {
    assert(notification.delivery_target, 'Pulled notification should include delivery_target');
    assert(notification.delivery_target.chat_id === 'test-chat-123', 'Pulled delivery target should match inherited lane target');
    assert(notification.delivery_target.thread_id === null, 'Pulled delivery target thread_id should be null');
  });

  const claimedAfterPull = await getTaskNotificationsByTaskId(taskB.task.task_id);
  assert(claimedAfterPull.some((notification) => notification.delivery_state === 'claimed'), 'Pulled notifications should be claimed');

  const deliveredRow = await markTaskNotificationDelivered(pullB[0].notification_id, {
    deliveredMessageId: 'tg_msg_inheritance_test',
    timestamp: new Date().toISOString(),
  });
  assert(deliveredRow, 'Delivery ACK helper should return the updated notification row');
  assert(deliveredRow.delivery_state === 'delivered', 'Delivery ACK should mark notification delivered');
  assert(deliveredRow.delivered_message_id === 'tg_msg_inheritance_test', 'Delivery ACK should store telegram message id');

  const deliveredRows = await getTaskNotificationsByTaskId(taskB.task.task_id);
  assert(deliveredRows.some((notification) => notification.delivery_state === 'delivered'), 'At least one inherited-session notification should be delivered');

  const liveKeyB = await mintLiveKeyForUser({
    user_id: `inherit_other_${Date.now()}`,
  });
  const sessionC = await createLiveKeySessionRecord(db, liveKeyB, '1h');
  const sessionTargetC = await getStoredSessionDeliveryTargetBySessionId(db, sessionC.session_id);
  assert(!sessionTargetC, 'Unbound live key should not inherit a delivery target');
  const liveKeyTargetC = await getStoredLiveKeyDeliveryTargetByLiveKeyId(db, liveKeyB.id);
  assert(!liveKeyTargetC, 'Unbound live key should not have a durable delivery target');

  const taskC = await buildTask(sessionC.session_id, 'unbound');
  const pullC = await pullTaskNotificationsForSession(sessionC.session_id, {
    limit: 20,
    timestamp: new Date().toISOString(),
  });
  assert(Number(pullC.length || 0) === 0, 'Unbound session should withhold notifications');

  const unclaimedRows = await getTaskNotificationsByTaskId(taskC.task.task_id);
  assert(unclaimedRows.length > 0, 'Unbound-session task should still create notifications');
  assert(unclaimedRows.every((notification) => notification.delivery_state === 'pending'), 'Unbound-session notifications should remain pending');

  console.log(JSON.stringify({
    status: 'pass',
    live_key_id: liveKeyA.id,
    live_key_delivery_target: liveKeyTargetA,
    inherited_session_id: sessionB.session_id,
    inherited_session_delivery_target: sessionTargetB,
    verified_shapes: [
      'live_key_bind_persists_durable_target',
      'fresh_session_inherits_target',
      'notifications_claimable_after_rotation',
      'ack_still_works',
      'unrelated_live_key_isolated',
      'unbound_lane_withholds_notifications',
    ],
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
NODE
