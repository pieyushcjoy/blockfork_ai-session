#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-cleanbench-integrity-XXXXXX)"
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
cp "$REPO_ROOT/package.json" "$TMP_DIR/package.json"
ln -s "$REPO_ROOT/node_modules" "$TMP_DIR/node_modules"

mkdir -p "$TMP_DIR/public"

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
  mintLiveKeyForUser,
  loadPersistedLiveKeyByApiKey,
  createLiveKeySessionRecord,
  bindLiveKeyDeliveryTarget,
  ensureSessionDeliveryTargetForSessionTx,
  getStoredSessionDeliveryTargetBySessionId,
  getStoredLiveKeyDeliveryTargetByLiveKeyId,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  TASK_STATES,
  EXECUTION_STATES,
  getTaskCompletionSummaryByTaskId,
  pullTaskNotificationsForSession,
  getTaskNotificationsByTaskId,
  markTaskNotificationDelivered,
  classifyManagedTerminalCompletionIntegrity,
  buildManagedTerminalWireOutcome,
  buildManagedTerminalFallbackText,
  normalizeResponsesIncompleteResponseFromChat,
  normalizeResponsesFallbackResponseFromChat,
} = runtime;

async function buildProgressTask(sessionId, label) {
  const requestId = `cleanbench_${label}_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `cleanbench_task_${label}_${crypto.randomUUID()}`,
    objectiveText: 'Create a concise Markdown product brief.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `cleanbench_exec_${label}_${crypto.randomUUID()}`,
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

  return { task, execution };
}

(async () => {
  await ensureBillingDb();

  const terminalGate = classifyManagedTerminalCompletionIntegrity({
    status: 'success',
    outputTextLength: 0,
    verifiedArtifactExists: false,
  });

  assert(terminalGate, 'Expected empty terminal completion to trigger integrity classification');
  assert(terminalGate.targetState === EXECUTION_STATES.RECOVERY_REQUIRED, 'Empty terminal completion should require recovery');
  assert(terminalGate.billingStatus === 'interrupted', 'Empty terminal completion should not be billed as success');
  assert(terminalGate.reasonCode === 'terminal_payload_missing', 'Terminal integrity reason code mismatch');
  assert(terminalGate.recoveryReason === 'empty_terminal_response', 'Terminal integrity recovery reason mismatch');

  const wireOutcome = buildManagedTerminalWireOutcome({
    session_id: 'wire_session',
  }, 'managed', `wire_resp_${crypto.randomUUID()}`, Math.floor(Date.now() / 1000), {
    status: 'success',
    outputTextLength: 0,
    verifiedArtifactExists: false,
  });
  assert(wireOutcome, 'Expected terminal wire outcome for empty managed completion');
  assert(wireOutcome.eventType === 'response.incomplete', 'Terminal wire outcome should emit response.incomplete');
  assert(wireOutcome.response.status === 'incomplete', 'Terminal wire response should be incomplete');
  assert(wireOutcome.response.incomplete_details.reason === 'terminal_payload_missing', 'Terminal wire response reason mismatch');
  assert(Array.isArray(wireOutcome.response.output) && wireOutcome.response.output.length === 0, 'Terminal wire response should have no output');

  const incompleteResponsesPayload = normalizeResponsesIncompleteResponseFromChat({
    id: 'resp_wire_incomplete',
    created: Math.floor(Date.now() / 1000),
    usage: { total_tokens: 0 },
  }, 'managed', wireOutcome.response.incomplete_details);
  assert(incompleteResponsesPayload.status === 'incomplete', 'Responses compatibility payload should be incomplete');
  assert(incompleteResponsesPayload.incomplete_details.reason === 'terminal_payload_missing', 'Responses compatibility incomplete reason mismatch');
  assert(Array.isArray(incompleteResponsesPayload.output) && incompleteResponsesPayload.output.length === 0, 'Responses compatibility payload should have no output');

  const nonWireOutcome = buildManagedTerminalWireOutcome({
    session_id: 'wire_session_ok',
  }, 'managed', `wire_resp_ok_${crypto.randomUUID()}`, Math.floor(Date.now() / 1000), {
    status: 'success',
    outputTextLength: 12,
    verifiedArtifactExists: false,
  });
  assert(!nonWireOutcome, 'Non-empty managed completion should not emit an incomplete wire outcome');

  const fallbackPromptBody = {
    messages: [
      {
        role: 'user',
        content: 'Create a markdown file named relay-acceptance-note.md that briefly explains the acceptance run.',
      },
    ],
  };
  const fallbackText = buildManagedTerminalFallbackText(fallbackPromptBody);
  assert(fallbackText && fallbackText.length > 0, 'Artifact-style prompt should produce a fallback terminal message');
  assert(fallbackText.includes('relay-acceptance-note.md'), 'Fallback terminal message should reference the requested filename');

  const fallbackResponsesPayload = normalizeResponsesFallbackResponseFromChat({
    id: 'resp_wire_fallback',
    created: Math.floor(Date.now() / 1000),
    usage: { total_tokens: 0 },
  }, 'managed', fallbackText);
  assert(Array.isArray(fallbackResponsesPayload.output) && fallbackResponsesPayload.output.length === 1, 'Fallback responses payload should have a single assistant message');
  assert(String(fallbackResponsesPayload.output[0]?.content?.[0]?.text || '').length > 0, 'Fallback responses payload should include non-empty output text');

  const terminalSessionId = `terminal_${Date.now()}_${crypto.randomUUID()}`;
  const terminalTask = await createTaskRecord({
    sessionId: terminalSessionId,
    requestId: `terminal_req_${crypto.randomUUID()}`,
    idempotencyKey: `terminal_task_${crypto.randomUUID()}`,
    objectiveText: 'Create a markdown file named progress-delivery-benchmark.md.',
    actorSource: 'test',
    reasonCode: 'task_received',
  });
  const terminalExecution = await createExecutionRecord({
    sessionId: terminalSessionId,
    requestId: `terminal_req_${crypto.randomUUID()}_exec`,
    idempotencyKey: `terminal_exec_${crypto.randomUUID()}`,
    taskId: terminalTask.task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  });

  await transitionTask(terminalTask.task.task_id, TASK_STATES.ACKNOWLEDGED, {
    executionId: terminalExecution.execution.execution_id,
    requestId: terminalExecution.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
    message: 'Task accepted. I am starting the work now.',
  });
  await transitionTask(terminalTask.task.task_id, TASK_STATES.PLANNED, {
    executionId: terminalExecution.execution.execution_id,
    requestId: terminalExecution.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_planned',
    message: 'I have locked the plan and am moving into execution.',
  });
  await transitionExecution(terminalExecution.execution.execution_id, EXECUTION_STATES.QUEUED, {
    requestId: terminalExecution.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await transitionExecution(terminalExecution.execution.execution_id, EXECUTION_STATES.RUNNING, {
    requestId: terminalExecution.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_running',
  });
  await transitionExecution(terminalExecution.execution.execution_id, EXECUTION_STATES.RECOVERY_REQUIRED, {
    requestId: terminalExecution.execution.last_request_id,
    actorSource: 'test',
    reasonCode: terminalGate.reasonCode,
    recoveryReason: terminalGate.recoveryReason,
    notes: terminalGate.reasonDetail,
  });

  const terminalSummary = await getTaskCompletionSummaryByTaskId(terminalTask.task.task_id);
  assert(terminalSummary, 'Terminal integrity task summary missing');
  assert(terminalSummary.final_state === TASK_STATES.RECOVERY_REQUIRED, `Unexpected terminal integrity final state: ${terminalSummary.final_state}`);
  assert(terminalSummary.summary_text.includes('usable terminal response'), 'Terminal integrity summary should mention unusable terminal response');
  assert(terminalSummary.follow_up_needed === 1, 'Terminal integrity task should require follow-up');
  assert(terminalSummary.not_verified.some((item) => item.includes('terminal payload missing')), 'Terminal integrity summary should mention missing terminal payload');
  assert(terminalSummary.proof.failure_fact_id, 'Terminal integrity summary should include a failure fact');

  const cleanbenchKey = await mintLiveKeyForUser({
    user_id: `cleanbench_${Date.now()}`,
  });
  const liveKeyRow = await loadPersistedLiveKeyByApiKey(cleanbenchKey.key);
  const initialSession = await createLiveKeySessionRecord(await ensureBillingDb(), liveKeyRow, '1h');

  const deliveryTarget = {
    delivery_target: {
      channel: 'telegram',
      chat_id: 'cleanbench-chat-001',
      thread_id: null,
    },
  };

  const liveKeyTarget = await bindLiveKeyDeliveryTarget(cleanbenchKey.id, deliveryTarget, {
    timestamp: new Date().toISOString(),
  });
  assert(liveKeyTarget, 'Live-key delivery target should be persisted');
  const storedLiveKeyTarget = await getStoredLiveKeyDeliveryTargetByLiveKeyId(await ensureBillingDb(), cleanbenchKey.id);
  assert(storedLiveKeyTarget, 'Durable live-key delivery target missing');
  assert(storedLiveKeyTarget.chat_id === 'cleanbench-chat-001', 'Durable live-key delivery target chat_id mismatch');

  const hydratedSessionTarget = await ensureSessionDeliveryTargetForSessionTx(await ensureBillingDb(), initialSession.session_id, {
    timestamp: new Date().toISOString(),
  });
  assert(hydratedSessionTarget, 'Current session should materialize a delivery target from the live-key lane');
  assert(hydratedSessionTarget.chat_id === 'cleanbench-chat-001', 'Hydrated session delivery target chat_id mismatch');

  const freshSession = await createLiveKeySessionRecord(await ensureBillingDb(), liveKeyRow, initialSession.ttl_selected);
  const freshSessionTarget = await getStoredSessionDeliveryTargetBySessionId(await ensureBillingDb(), freshSession.session_id);
  assert(freshSessionTarget, 'Fresh session should inherit the live-key delivery target');
  assert(freshSessionTarget.chat_id === 'cleanbench-chat-001', 'Fresh session inherited delivery target chat_id mismatch');

  const deliveryTask = await buildProgressTask(freshSession.session_id, 'delivery');
  await transitionExecution(deliveryTask.execution.execution_id, EXECUTION_STATES.COMPLETED, {
    requestId: deliveryTask.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });
  await transitionTask(deliveryTask.task.task_id, TASK_STATES.COMPLETED, {
    executionId: deliveryTask.execution.execution_id,
    requestId: deliveryTask.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_completed',
    message: 'The task is complete.',
  });

  const notificationsBeforePull = await getTaskNotificationsByTaskId(deliveryTask.task.task_id);
  assert(notificationsBeforePull.length > 0, 'Delivery task should create notifications');

  const pulledNotifications = await pullTaskNotificationsForSession(freshSession.session_id, {
    limit: 20,
    timestamp: new Date().toISOString(),
  });
  assert(pulledNotifications.length > 0, 'Fresh live-key session should pull claimable notifications');
  pulledNotifications.forEach((notification) => {
    assert(notification.delivery_target, 'Pulled notification should include a delivery target');
    assert(notification.delivery_target.chat_id === 'cleanbench-chat-001', 'Pulled delivery target should match the provisioned live-key target');
  });

  const delivered = await markTaskNotificationDelivered(pulledNotifications[0].notification_id, {
    deliveredMessageId: `tg_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
  });
  assert(delivered, 'Notification delivery ACK should succeed');
  assert(delivered.delivery_state === 'delivered', 'Notification should transition to delivered');

  console.log(JSON.stringify({
    status: 'pass',
    terminal_integrity: terminalGate,
    terminal_summary_state: terminalSummary.final_state,
    live_key_id: cleanbenchKey.id,
    live_key_delivery_target: storedLiveKeyTarget,
    hydrated_session_id: initialSession.session_id,
    fresh_session_id: freshSession.session_id,
    inherited_session_delivery_target: freshSessionTarget,
    pulled_notification_count: pulledNotifications.length,
    verified_shapes: [
      'empty_terminal_response_becomes_recovery_required',
      'empty_terminal_response_becomes_response_incomplete',
      'responses_compatibility_payload_becomes_incomplete',
      'summary_reflects_unusable_terminal_output',
      'live_key_target_persists',
      'fresh_session_inherits_target',
      'notifications_claimable_and_acked',
    ],
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
