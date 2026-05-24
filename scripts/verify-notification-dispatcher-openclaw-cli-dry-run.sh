#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-notification-dispatcher-XXXXXX)"
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
const mode = process.env.FAKE_OPENCLAW_MODE || 'success';
const capturePath = process.env.FAKE_OPENCLAW_CAPTURE_PATH || '';

function readFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || '' : '';
}

if (capturePath) {
  fs.appendFileSync(capturePath, `${JSON.stringify({ argv: args, mode })}\n`);
}

if (mode === 'failure') {
  console.error('simulated openclaw dry-run failure');
  process.exit(17);
}

const target = readFlag('--target');
const threadId = readFlag('--thread-id');
const message = readFlag('--message');
const json = {
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
};
process.stdout.write(`${JSON.stringify(json)}\n`);
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
process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = path.join(tmpDir, 'workspace');
process.env.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
process.env.BLOCKFORK_OPENCLAW_CLI_BIN = path.join(tmpDir, 'bin', 'openclaw');
process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = '1';
process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS = '5000';
process.env.FAKE_OPENCLAW_CAPTURE_PATH = capturePath;
process.env.FAKE_OPENCLAW_MODE = 'success';

process.chdir(tmpDir);
const runtime = require(path.join(tmpDir, 'server.js'));
const {
  ensureBillingDb,
  createSessionRecord,
  createLiveKeySessionRecord,
  getOrCreateLiveKeyForSession,
  mintLiveKeyForUser,
  bindLiveKeyDeliveryTarget,
  bindSessionDeliveryTarget,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  TASK_STATES,
  EXECUTION_STATES,
  getTaskNotificationsByTaskId,
  getNotificationDeliveryAttemptByNotificationId,
  dispatchPendingTaskNotifications,
} = runtime;

async function createTaskWithNotifications(sessionId, label) {
  const requestId = `dispatch_req_${label}_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `dispatch_task_${label}_${crypto.randomUUID()}`,
    objectiveText: `Create a markdown file named ${label}.md with a concise brief.`,
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `dispatch_exec_${label}_${crypto.randomUUID()}`,
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

  const sessionBase = await createSessionRecord({
    user_id: `dispatcher_${Date.now()}_base`,
  });
  const liveKeyBase = await getOrCreateLiveKeyForSession(sessionBase, {
    user_id: sessionBase.user_id || null,
  });
  const baseTarget = {
    delivery_target: {
      channel: 'telegram',
      chat_id: '8407120350',
      thread_id: null,
    },
  };
  await bindLiveKeyDeliveryTarget(liveKeyBase.id, baseTarget, { timestamp: new Date().toISOString() });
  const inheritedSession = await createLiveKeySessionRecord(db, liveKeyBase, sessionBase.ttl_selected);
  const inheritedTask = await createTaskWithNotifications(inheritedSession.session_id, 'inherited');

  const sessionThread = await createSessionRecord({
    user_id: `dispatcher_${Date.now()}_thread`,
  });
  const threadedTarget = {
    delivery_target: {
      channel: 'telegram',
      chat_id: '8407120350',
      thread_id: 'thread-42',
    },
  };
  await bindSessionDeliveryTarget(sessionThread.session_id, threadedTarget, { timestamp: new Date().toISOString() });
  const threadedSession = sessionThread;
  const threadedTask = await createTaskWithNotifications(threadedSession.session_id, 'threaded');

  const sessionNoTarget = await createSessionRecord({
    user_id: `dispatcher_${Date.now()}_unbound`,
  });
  const unboundTask = await createTaskWithNotifications(sessionNoTarget.session_id, 'unbound');

  const summarySuccess = await dispatchPendingTaskNotifications({
    limit: 20,
    claimLimit: 20,
    dryRun: true,
    commandPath: path.join(tmpDir, 'bin', 'openclaw'),
    transport: 'openclaw_cli',
    timeoutMs: 5000,
    timestamp: new Date().toISOString(),
  });
  assert(summarySuccess.claimed_notification_count > 0, 'Dispatcher should claim notifications on dry-run success');
  assert(summarySuccess.delivered_notification_count > 0, 'Dispatcher should deliver notifications on dry-run success');
  assert(summarySuccess.failed_notification_count === 0, 'Dispatcher should not fail on dry-run success');

  const captureLines = fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert(captureLines.length > 0, 'Expected OpenClaw CLI stub invocations');
  assert(captureLines.every((entry) => Array.isArray(entry.argv) && entry.argv.includes('message') && entry.argv.includes('send')), 'CLI argv should include message send');
  assert(captureLines.every((entry) => entry.argv.includes('--channel') && entry.argv.includes('telegram')), 'CLI argv should include telegram channel');
  assert(captureLines.every((entry) => entry.argv.includes('--dry-run')), 'CLI argv should include dry-run');
  assert(captureLines.every((entry) => entry.argv.includes('--json')), 'CLI argv should include json');
  assert(captureLines.some((entry) => entry.argv.includes('--thread-id') && entry.argv.includes('thread-42')), 'CLI argv should include thread-id for threaded target');
  assert(captureLines.some((entry) => entry.argv.includes('--target') && entry.argv.includes('8407120350')), 'CLI argv should include the numeric telegram target');

  const inheritedNotifications = await getTaskNotificationsByTaskId(inheritedTask.task.task_id);
  assert(inheritedNotifications.length > 0, 'Inherited task should create notifications');
  assert(inheritedNotifications.every((notification) => notification.delivery_state === 'delivered'), 'Inherited notifications should be delivered');
  const inheritedLatestAttempt = await getNotificationDeliveryAttemptByNotificationId(inheritedNotifications[0].notification_id);
  assert(inheritedLatestAttempt, 'Expected latest attempt for inherited notification');
  assert(inheritedLatestAttempt.success, 'Inherited delivery attempt should be successful');
  assert(inheritedLatestAttempt.dry_run, 'Inherited delivery attempt should be dry-run');

  const threadedNotifications = await getTaskNotificationsByTaskId(threadedTask.task.task_id);
  assert(threadedNotifications.length > 0, 'Threaded task should create notifications');
  assert(threadedNotifications.every((notification) => notification.delivery_state === 'delivered'), 'Threaded notifications should be delivered');
  const threadedLatestAttempt = await getNotificationDeliveryAttemptByNotificationId(threadedNotifications[0].notification_id);
  assert(threadedLatestAttempt, 'Expected latest attempt for threaded notification');
  assert(threadedLatestAttempt.success, 'Threaded delivery attempt should be successful');
  assert(threadedLatestAttempt.dry_run, 'Threaded delivery attempt should be dry-run');

  const unboundBefore = await getTaskNotificationsByTaskId(unboundTask.task.task_id);
  assert(unboundBefore.length > 0, 'Unbound task should create notifications');
  assert(unboundBefore.every((notification) => notification.delivery_state === 'pending'), 'Unbound notifications should begin pending');

  const unboundCaptureCountBefore = captureLines.length;
  const summarySkip = await dispatchPendingTaskNotifications({
    limit: 20,
    claimLimit: 20,
    dryRun: true,
    commandPath: path.join(tmpDir, 'bin', 'openclaw'),
    transport: 'openclaw_cli',
    timeoutMs: 5000,
    timestamp: new Date().toISOString(),
  });
  assert(summarySkip.skipped_notification_count >= 1, 'Dispatcher should skip unbound notifications');
  const captureLinesAfterSkip = fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert(captureLinesAfterSkip.length === unboundCaptureCountBefore, 'Unbound notifications should not invoke CLI');

  const sessionFailure = await createSessionRecord({
    user_id: `dispatcher_${Date.now()}_failure`,
  });
  const liveKeyFailure = await getOrCreateLiveKeyForSession(sessionFailure, {
    user_id: sessionFailure.user_id || null,
  });
  await bindLiveKeyDeliveryTarget(liveKeyFailure.id, baseTarget, { timestamp: new Date().toISOString() });
  const failureSession = await createLiveKeySessionRecord(db, liveKeyFailure, sessionFailure.ttl_selected);
  const failureTask = await createTaskWithNotifications(failureSession.session_id, 'failure');

  process.env.FAKE_OPENCLAW_MODE = 'failure';
  const summaryFailure = await dispatchPendingTaskNotifications({
    limit: 20,
    claimLimit: 20,
    dryRun: true,
    commandPath: path.join(tmpDir, 'bin', 'openclaw'),
    transport: 'openclaw_cli',
    timeoutMs: 5000,
    timestamp: new Date().toISOString(),
  });
  assert(summaryFailure.failed_notification_count > 0, 'Dispatcher should record failures when CLI exits non-zero');

  const failureNotifications = await getTaskNotificationsByTaskId(failureTask.task.task_id);
  assert(failureNotifications.length > 0, 'Failure task should create notifications');
  assert(failureNotifications.every((notification) => notification.delivery_state === 'pending' || notification.delivery_state === 'failed'), 'Failure notifications should not be delivered');
  const failureLatestAttempt = await getNotificationDeliveryAttemptByNotificationId(failureNotifications[0].notification_id);
  assert(failureLatestAttempt, 'Expected latest attempt for failure notification');
  assert(!failureLatestAttempt.success, 'Failure attempt should not succeed');
  assert(failureLatestAttempt.retryable, 'Failure attempt should be retryable');

  console.log(JSON.stringify({
    status: 'pass',
    summary_success: summarySuccess,
    summary_skip: summarySkip,
    summary_failure: summaryFailure,
    sample_attempts: {
      inherited: inheritedLatestAttempt,
      threaded: threadedLatestAttempt,
      failure: failureLatestAttempt,
    },
    captured_invocations: captureLines.length,
    cleanbench_safe: true,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
NODE
