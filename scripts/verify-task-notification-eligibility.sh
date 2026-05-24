#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-task-notification-eligibility-XXXXXX)"
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
require_cmd sqlite3

mkdir -p "$TMP_DIR/workspace/html" "$TMP_DIR/workspace/markdown" "$TMP_DIR/bin"
cp "$REPO_ROOT/server.js" "$TMP_DIR/server.js"
cp "$REPO_ROOT/package.json" "$TMP_DIR/package.json"
ln -s "$REPO_ROOT/node_modules" "$TMP_DIR/node_modules"
mkdir -p "$TMP_DIR/public"

cat > "$TMP_DIR/bin/openclaw" <<'NODE'
#!/usr/bin/env node
const fs = require('fs');

const args = process.argv.slice(2);
const capturePath = process.env.FAKE_OPENCLAW_CAPTURE_PATH || '';
const mode = process.env.FAKE_OPENCLAW_MODE || 'success';

function readFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '') : '';
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
const dryRun = args.includes('--dry-run');

const payload = {
  action: 'send',
  channel: 'telegram',
  dryRun,
  handledBy: dryRun ? 'core' : 'plugin',
  payload: {
    channel: 'telegram',
    to: `telegram:${target}`,
    via: 'direct',
    mediaUrl: null,
    dryRun,
    message,
  },
};

if (!dryRun) {
  payload.payload.ok = true;
  payload.payload.messageId = '999';
  payload.payload.chatId = target;
}

if (threadId) {
  payload.payload.threadId = threadId;
}

process.stdout.write(`${JSON.stringify(payload)}\n`);
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

function nowIso() {
  return new Date().toISOString();
}

function tableColumns(db, tableName) {
  const stmt = db.prepare(`PRAGMA table_info(${tableName})`);
  const columns = [];
  while (stmt.step()) {
    columns.push(String(stmt.getAsObject().name || ''));
  }
  stmt.free();
  return columns;
}

function assertColumns(db, tableName, expectedColumns) {
  const columns = new Set(tableColumns(db, tableName));
  for (const column of expectedColumns) {
    assert(columns.has(column), `Missing ${tableName}.${column}`);
  }
}

async function fetchTask(runtime, taskId) {
  const task = await runtime.getTaskById(taskId);
  assert(task, `Missing task ${taskId}`);
  return task;
}

async function fetchNotifications(runtime, taskId) {
  const notifications = await runtime.getTaskNotificationsByTaskId(taskId);
  assert(Array.isArray(notifications), `Missing notifications for ${taskId}`);
  return notifications;
}

async function createTargetedLiveKeySession(runtime, db, label, deliveryTarget) {
  const sessionBase = await runtime.createSessionRecord({
    user_id: `eligibility_${label}_${Date.now()}`,
  });
  const liveKey = await runtime.getOrCreateLiveKeyForSession(sessionBase, {
    user_id: sessionBase.user_id || null,
  });
  await runtime.bindLiveKeyDeliveryTarget(liveKey.id, {
    delivery_target: deliveryTarget,
  }, { timestamp: nowIso() });
  const activeSession = await runtime.createLiveKeySessionRecord(db, liveKey, sessionBase.ttl_selected);
  const inheritedTarget = await runtime.getStoredSessionDeliveryTargetBySessionId(db, activeSession.session_id);
  assert(inheritedTarget, `Expected inherited delivery target for ${label}`);
  return {
    session: activeSession,
    liveKey,
    target: inheritedTarget,
  };
}

async function createSimpleTextTask(runtime, db, label, objectiveText) {
  const sessionPack = await createTargetedLiveKeySession(runtime, db, label, {
    channel: 'telegram',
    chat_id: '8407120350',
    thread_id: null,
  });
  const requestId = `elig_${label}_${crypto.randomUUID()}`;
  const taskResult = await runtime.createTaskRecord({
    sessionId: sessionPack.session.session_id,
    requestId,
    idempotencyKey: `elig_task_${label}_${crypto.randomUUID()}`,
    objectiveText,
    actorSource: 'test',
    reasonCode: 'task_received',
  });
  const task = taskResult.task;
  const execution = (await runtime.createExecutionRecord({
    sessionId: sessionPack.session.session_id,
    requestId: `${requestId}_exec`,
    idempotencyKey: `elig_exec_${label}_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.ACKNOWLEDGED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
    message: 'Task accepted. I am starting the work now.',
  });
  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.PLANNED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_planned',
    message: 'I have locked the plan and am moving into execution.',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_running',
  });
  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.TOOL_WORK_STARTED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'tool_work_started',
    message: 'Tool work has started.',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });
  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.COMPLETED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_completed',
    message: 'The task is complete.',
  });

  return {
    task: await fetchTask(runtime, task.task_id),
    execution,
    session: sessionPack.session,
    liveKey: sessionPack.liveKey,
    target: sessionPack.target,
  };
}

async function createAdmissionClassifiedTask(runtime, db, label, admissionBody) {
  const objectiveText = runtime.summarizeTaskObjectiveFromBody(admissionBody);
  assert(String(objectiveText || '').length > 0, `Expected summarized objective text for ${label}`);
  return createSimpleTextTask(runtime, db, label, objectiveText);
}

async function createArtifactTask(runtime, db, tmpDir, label, objectiveText, relativePath, fileContents, completionText) {
  const sessionPack = await createTargetedLiveKeySession(runtime, db, label, {
    channel: 'telegram',
    chat_id: '8407120350',
    thread_id: null,
  });
  const requestId = `artifact_${label}_${crypto.randomUUID()}`;
  const taskResult = await runtime.createTaskRecord({
    sessionId: sessionPack.session.session_id,
    requestId,
    idempotencyKey: `artifact_task_${label}_${crypto.randomUUID()}`,
    objectiveText,
    actorSource: 'test',
    reasonCode: 'task_received',
  });
  const task = taskResult.task;
  const execution = (await runtime.createExecutionRecord({
    sessionId: sessionPack.session.session_id,
    requestId: `${requestId}_exec`,
    idempotencyKey: `artifact_exec_${label}_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.ACKNOWLEDGED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
    message: 'Task accepted. I am starting the work now.',
  });
  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.PLANNED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_planned',
    message: 'I have locked the plan and am moving into execution.',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_running',
  });

  const artifactPath = path.join(tmpDir, 'workspace', relativePath);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, fileContents);

  const binding = await runtime.prepareArtifactBindingForExecution(execution.execution_id, {
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
    timestamp: nowIso(),
  });
  assert(binding.ok, `Artifact binding failed for ${label}: ${binding.reason || 'unknown'}`);

  const validation = await runtime.validateArtifactHonestyOrError({
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
  }, completionText, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    meaningfulOutputStarted: true,
  });
  assert(validation === null, `Unexpected artifact honesty failure for ${label}: ${validation?.message || 'unknown'}`);

  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });
  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.COMPLETED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_completed',
    message: 'The task is complete.',
  });

  return {
    task: await fetchTask(runtime, task.task_id),
    execution,
    session: sessionPack.session,
    liveKey: sessionPack.liveKey,
    target: sessionPack.target,
    artifactPath,
  };
}

async function createRecoveryTask(runtime, db, label, objectiveText) {
  const sessionPack = await createTargetedLiveKeySession(runtime, db, label, {
    channel: 'telegram',
    chat_id: '8407120350',
    thread_id: null,
  });
  const requestId = `recovery_${label}_${crypto.randomUUID()}`;
  const taskResult = await runtime.createTaskRecord({
    sessionId: sessionPack.session.session_id,
    requestId,
    idempotencyKey: `recovery_task_${label}_${crypto.randomUUID()}`,
    objectiveText,
    actorSource: 'test',
    reasonCode: 'task_received',
  });
  const task = taskResult.task;
  const execution = (await runtime.createExecutionRecord({
    sessionId: sessionPack.session.session_id,
    requestId: `${requestId}_exec`,
    idempotencyKey: `recovery_exec_${label}_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.ACKNOWLEDGED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
    message: 'Task accepted. I am starting the work now.',
  });
  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.PLANNED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_planned',
    message: 'I have locked the plan and am moving into execution.',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_running',
  });
  await runtime.transitionExecution(execution.execution_id, runtime.EXECUTION_STATES.RECOVERY_REQUIRED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'terminal_payload_missing',
  });
  await runtime.transitionTask(task.task_id, runtime.TASK_STATES.RECOVERY_REQUIRED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'terminal_payload_missing',
    message: 'I could not produce a usable terminal response.',
  });

  return {
    task: await fetchTask(runtime, task.task_id),
    execution,
    session: sessionPack.session,
    liveKey: sessionPack.liveKey,
    target: sessionPack.target,
  };
}

(async () => {
  const repoRoot = process.argv[2];
  const tmpDir = process.argv[3];
  const dbPath = path.join(tmpDir, 'billing.sqlite');
  const capturePath = path.join(tmpDir, 'invocations.jsonl');

  process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = path.join(tmpDir, 'workspace');
  process.env.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
  process.env.BLOCKFORK_OPENCLAW_CLI_BIN = path.join(tmpDir, 'bin', 'openclaw');
  process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = '1';
  process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS = '5000';
  process.env.FAKE_OPENCLAW_CAPTURE_PATH = capturePath;
  process.env.FAKE_OPENCLAW_MODE = 'success';

  const runtime = require(path.join(tmpDir, 'server.js'));
  const {
    ensureBillingDb,
    createSessionRecord,
    getOrCreateLiveKeyForSession,
    createLiveKeySessionRecord,
    bindLiveKeyDeliveryTarget,
    createTaskRecord,
    createExecutionRecord,
    transitionTask,
    transitionExecution,
    TASK_STATES,
    EXECUTION_STATES,
    getTaskById,
    getTaskNotificationsByTaskId,
    getNotificationDeliveryAttemptByNotificationId,
    dispatchTaskNotificationById,
    dispatchPendingTaskNotifications,
  } = runtime;

  const TASK_NOTIFICATION_POLICIES = Object.freeze({
    SILENT: 'silent',
    COMPLETION_ONLY: 'completion_only',
    PROGRESS_AND_COMPLETION: 'progress_and_completion',
    FAILURE_ONLY: 'failure_only',
  });

  const TASK_KINDS = Object.freeze({
    SIMPLE_CHAT: 'simple_chat',
    TEXT_GENERATION: 'text_generation',
    STRUCTURED_TEXT: 'structured_text',
    ARTIFACT_TASK: 'artifact_task',
    CODE_TASK: 'code_task',
    WEBSITE_TASK: 'website_task',
    RESEARCH_TASK: 'research_task',
    MEDIA_TASK: 'media_task',
    LONG_RUNNING_TASK: 'long_running_task',
    RECOVERY_OR_FAILURE: 'recovery_or_failure',
  });

  const db = await ensureBillingDb();

  assertColumns(db, 'tasks', [
    'task_kind',
    'notification_policy',
    'notification_eligible',
    'eligibility_reason',
    'classified_at',
  ]);
  assertColumns(db, 'task_notifications', [
    'task_kind',
    'notification_policy',
    'proactive_eligible',
    'eligibility_reason',
    'delivery_suppressed_reason',
    'classified_at',
  ]);

  const cases = {};

  const simpleOk = await createSimpleTextTask(runtime, db, 'simple_ok', 'Reply with exactly OK and nothing else.');
  cases.simple_ok = {
    task_id: simpleOk.task.task_id,
    task_kind: simpleOk.task.task_kind,
    notification_policy: simpleOk.task.notification_policy,
    notification_eligible: Number(simpleOk.task.notification_eligible || 0),
  };
  assert([TASK_KINDS.SIMPLE_CHAT, TASK_KINDS.TEXT_GENERATION].includes(simpleOk.task.task_kind), `Unexpected kind for simple OK: ${simpleOk.task.task_kind}`);
  assert(simpleOk.task.notification_policy === TASK_NOTIFICATION_POLICIES.SILENT, `Simple OK should be silent, got ${simpleOk.task.notification_policy}`);
  assert(Number(simpleOk.task.notification_eligible || 0) === 0, 'Simple OK should not be notification eligible');
  const simpleOkNotifications = await getTaskNotificationsByTaskId(simpleOk.task.task_id);
  assert(simpleOkNotifications.length === 4, `Simple OK should create 4 notifications, found ${simpleOkNotifications.length}`);
  assert(simpleOkNotifications.every((notification) => Number(notification.proactive_eligible || 0) === 0), 'Simple OK notifications should be suppressed');
  assert(simpleOkNotifications.every((notification) => String(notification.delivery_suppressed_reason || '').length > 0), 'Simple OK notifications should record suppression reasons');

  const simpleMotivational = await createSimpleTextTask(runtime, db, 'simple_motivation', 'Write a short motivational note.');
  cases.simple_motivational = {
    task_id: simpleMotivational.task.task_id,
    task_kind: simpleMotivational.task.task_kind,
    notification_policy: simpleMotivational.task.notification_policy,
  };
  assert(simpleMotivational.task.notification_policy === TASK_NOTIFICATION_POLICIES.SILENT, 'Short motivational note should be silent');

  const structuredShort = await createSimpleTextTask(runtime, db, 'structured_short', 'Summarize consistency in 4 bullet points.');
  cases.structured_short = {
    task_id: structuredShort.task.task_id,
    task_kind: structuredShort.task.task_kind,
    notification_policy: structuredShort.task.notification_policy,
  };
  assert(structuredShort.task.task_kind === TASK_KINDS.STRUCTURED_TEXT, `Structured prompt should classify as structured_text, got ${structuredShort.task.task_kind}`);
  assert(
    [TASK_NOTIFICATION_POLICIES.SILENT, TASK_NOTIFICATION_POLICIES.COMPLETION_ONLY].includes(structuredShort.task.notification_policy),
    `Structured text policy should be silent or completion_only, got ${structuredShort.task.notification_policy}`,
  );

  const wrappedArtifactPrompt = await createAdmissionClassifiedTask(runtime, db, 'artifact_admission', {
    messages: [{
      role: 'user',
      content: [
        'Conversation info (untrusted metadata): ',
        JSON.stringify({
          chat_id: 'telegram:8407120350',
          message_id: '408',
          inbound_event_kind: 'user_request',
        }),
        '\nSender (untrusted metadata): ',
        JSON.stringify({
          label: 'Onchain Hashira (8407120350)',
          id: '8407120350',
          name: 'Onchain Hashira',
          username: 'justhashira',
        }),
        '\nConversation context (untrusted, chronological, selected for current message): ',
        '#395 Sat 2026-05-23 19:47 GMT+5:30\n',
        'Create a markdown file named project-summary.md with a short 5-bullet summary of why consistency matters in difficult projects.',
      ].join(''),
    }],
  });
  cases.artifact_admission = {
    task_id: wrappedArtifactPrompt.task.task_id,
    task_kind: wrappedArtifactPrompt.task.task_kind,
    notification_policy: wrappedArtifactPrompt.task.notification_policy,
  };
  assert(wrappedArtifactPrompt.task.task_kind === TASK_KINDS.ARTIFACT_TASK, `Artifact admission prompt should classify as artifact_task, got ${wrappedArtifactPrompt.task.task_kind}`);
  assert(wrappedArtifactPrompt.task.notification_policy === TASK_NOTIFICATION_POLICIES.PROGRESS_AND_COMPLETION, `Artifact admission prompt should be progress_and_completion, got ${wrappedArtifactPrompt.task.notification_policy}`);
  const artifactAdmissionNotifications = await getTaskNotificationsByTaskId(wrappedArtifactPrompt.task.task_id);
  assert(artifactAdmissionNotifications.some((notification) => Number(notification.proactive_eligible || 0) === 1), 'Artifact admission notifications should be eligible');

  const wrappedWebsitePrompt = await createAdmissionClassifiedTask(runtime, db, 'website_admission', {
    messages: [{
      role: 'user',
      content: [
        'Conversation info (untrusted metadata): ',
        JSON.stringify({
          chat_id: 'telegram:8407120350',
          message_id: '409',
          inbound_event_kind: 'user_request',
        }),
        '\nSender (untrusted metadata): ',
        JSON.stringify({
          label: 'Onchain Hashira (8407120350)',
          id: '8407120350',
          name: 'Onchain Hashira',
          username: 'justhashira',
        }),
        '\nConversation context (untrusted, chronological, selected for current message): ',
        '#396 Sat 2026-05-23 19:48 GMT+5:30\n',
        'Build a simple landing page website for a coffee shop with a hero, menu highlights, and contact section.',
      ].join(''),
    }],
  });
  cases.website_admission = {
    task_id: wrappedWebsitePrompt.task.task_id,
    task_kind: wrappedWebsitePrompt.task.task_kind,
    notification_policy: wrappedWebsitePrompt.task.notification_policy,
  };
  assert([TASK_KINDS.WEBSITE_TASK, TASK_KINDS.CODE_TASK].includes(wrappedWebsitePrompt.task.task_kind), `Website admission prompt should classify as website/code task, got ${wrappedWebsitePrompt.task.task_kind}`);
  assert(wrappedWebsitePrompt.task.notification_policy === TASK_NOTIFICATION_POLICIES.PROGRESS_AND_COMPLETION, `Website admission prompt should be progress_and_completion, got ${wrappedWebsitePrompt.task.notification_policy}`);
  const websiteAdmissionNotifications = await getTaskNotificationsByTaskId(wrappedWebsitePrompt.task.task_id);
  assert(websiteAdmissionNotifications.some((notification) => Number(notification.proactive_eligible || 0) === 1), 'Website admission notifications should be eligible');

  const markdownTask = await createArtifactTask(
    runtime,
    db,
    tmpDir,
    'markdown_file',
    'Create a markdown file named relay-acceptance-note.md',
    path.join('markdown', 'relay-acceptance-note.md'),
    '# relay-acceptance-note\n\nThis is a verifier-created markdown artifact.\n',
    'Created the markdown artifact and verified the result.',
  );
  cases.markdown_file = {
    task_id: markdownTask.task.task_id,
    task_kind: markdownTask.task.task_kind,
    notification_policy: markdownTask.task.notification_policy,
  };
  assert(markdownTask.task.task_kind === TASK_KINDS.ARTIFACT_TASK, `Markdown prompt should classify as artifact_task, got ${markdownTask.task.task_kind}`);
  assert(markdownTask.task.notification_policy === TASK_NOTIFICATION_POLICIES.PROGRESS_AND_COMPLETION, `Markdown prompt should be progress_and_completion, got ${markdownTask.task.notification_policy}`);
  const markdownNotifications = await getTaskNotificationsByTaskId(markdownTask.task.task_id);
  assert(markdownNotifications.some((notification) => Number(notification.proactive_eligible || 0) === 1), 'Markdown artifact notifications should be eligible');

  const websiteTask = await createArtifactTask(
    runtime,
    db,
    tmpDir,
    'website_build',
    'Build a simple landing page website for a coffee shop',
    path.join('html', 'coffee-shop.html'),
    '<!doctype html><html><body><main><h1>Coffee Shop</h1></main></body></html>',
    'Built the landing page and verified the result.',
  );
  cases.website_build = {
    task_id: websiteTask.task.task_id,
    task_kind: websiteTask.task.task_kind,
    notification_policy: websiteTask.task.notification_policy,
  };
  assert([TASK_KINDS.WEBSITE_TASK, TASK_KINDS.CODE_TASK].includes(websiteTask.task.task_kind), `Website prompt should classify as website/code task, got ${websiteTask.task.task_kind}`);
  assert(websiteTask.task.notification_policy === TASK_NOTIFICATION_POLICIES.PROGRESS_AND_COMPLETION, `Website prompt should be progress_and_completion, got ${websiteTask.task.notification_policy}`);
  const websiteNotifications = await getTaskNotificationsByTaskId(websiteTask.task.task_id);
  assert(websiteNotifications.some((notification) => Number(notification.proactive_eligible || 0) === 1), 'Website notifications should be eligible');

  const recoveryTask = await createRecoveryTask(runtime, db, 'recovery_simple', 'Reply with exactly OK and nothing else.');
  cases.recovery_simple = {
    task_id: recoveryTask.task.task_id,
    task_kind: recoveryTask.task.task_kind,
    notification_policy: recoveryTask.task.notification_policy,
  };
  assert(recoveryTask.task.current_state === TASK_STATES.RECOVERY_REQUIRED, `Recovery task should be recovery_required, got ${recoveryTask.task.current_state}`);
  assert(recoveryTask.task.notification_policy === TASK_NOTIFICATION_POLICIES.FAILURE_ONLY, `Recovery task should be failure_only, got ${recoveryTask.task.notification_policy}`);
  const recoveryNotifications = await getTaskNotificationsByTaskId(recoveryTask.task.task_id);
  assert(recoveryNotifications.some((notification) => Number(notification.proactive_eligible || 0) === 1), 'Recovery notifications should be eligible');

  const guardTask = await createSimpleTextTask(runtime, db, 'guard_silent', 'Reply with exactly OK and nothing else.');
  const guardNotifications = await getTaskNotificationsByTaskId(guardTask.task.task_id);
  const guardCompletion = guardNotifications.find((notification) => notification.notification_kind === 'task_completed');
  assert(guardCompletion, 'Expected guard task completion notification');
  const captureBeforeGuard = fs.existsSync(capturePath)
    ? fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;
  const blockedDispatch = await dispatchTaskNotificationById(guardCompletion.notification_id, {
    commandPath: path.join(tmpDir, 'bin', 'openclaw'),
    dryRun: true,
  });
  assert(blockedDispatch.status === 'blocked', `Guard dispatch should block, got ${blockedDispatch.status}`);
  assert(blockedDispatch.reason_code === 'eligibility_suppressed', `Guard dispatch should be eligibility_suppressed, got ${blockedDispatch.reason_code}`);
  const captureAfterBlocked = fs.existsSync(capturePath)
    ? fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;
  assert(captureAfterBlocked === captureBeforeGuard, 'Blocked dispatch should not invoke CLI');
  const guardAfterBlocked = await getTaskNotificationsByTaskId(guardTask.task.task_id);
  assert(guardAfterBlocked.find((notification) => notification.notification_id === guardCompletion.notification_id).delivery_state === 'pending', 'Blocked silent notification should remain pending');

  const overrideDispatch = await dispatchTaskNotificationById(guardCompletion.notification_id, {
    commandPath: path.join(tmpDir, 'bin', 'openclaw'),
    dryRun: true,
    overrideEligibility: true,
  });
  assert(overrideDispatch.status === 'delivered', `Override dispatch should deliver, got ${overrideDispatch.status}`);
  const captureAfterOverride = fs.existsSync(capturePath)
    ? fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;
  assert(captureAfterOverride === captureBeforeGuard + 1, 'Override dispatch should invoke CLI exactly once');
  const overrideLatestAttempt = await getNotificationDeliveryAttemptByNotificationId(guardCompletion.notification_id);
  assert(overrideLatestAttempt, 'Override dispatch should record an attempt');
  assert(overrideLatestAttempt.success, 'Override dry-run attempt should succeed');
  assert(overrideLatestAttempt.dry_run, 'Override dispatch should be dry-run');
  const guardAfterOverride = await getTaskNotificationsByTaskId(guardTask.task.task_id);
  const deliveredGuard = guardAfterOverride.find((notification) => notification.notification_id === guardCompletion.notification_id);
  assert(deliveredGuard.delivery_state === 'delivered', 'Override silent notification should be delivered in admin mode');

  const broadSilent = await createSimpleTextTask(runtime, db, 'broad_silent', 'Reply with exactly OK and nothing else.');
  const broadEligible = await createArtifactTask(
    runtime,
    db,
    tmpDir,
    'broad_eligible',
    'Create a markdown file named broad-notify.md',
    path.join('markdown', 'broad-notify.md'),
    '# broad-notify\n\nThis artifact is used to verify dispatcher gating.\n',
    'Created the markdown artifact and verified the result.',
  );
  const broadSilentBefore = await getTaskNotificationsByTaskId(broadSilent.task.task_id);
  const broadEligibleBefore = await getTaskNotificationsByTaskId(broadEligible.task.task_id);
  assert(broadSilentBefore.every((notification) => Number(notification.proactive_eligible || 0) === 0), 'Broad silent notifications should be suppressed');
  assert(broadEligibleBefore.some((notification) => Number(notification.proactive_eligible || 0) === 1), 'Broad eligible notifications should be selectable');

  const captureBeforeBroad = fs.existsSync(capturePath)
    ? fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;
  const broadSummary = await dispatchPendingTaskNotifications({
    limit: 20,
    claimLimit: 20,
    dryRun: true,
    commandPath: path.join(tmpDir, 'bin', 'openclaw'),
    transport: 'openclaw_cli',
    timeoutMs: 5000,
    timestamp: nowIso(),
  });
  assert(broadSummary.claimed_notification_count > 0, 'Broad dispatcher should claim eligible notifications');
  assert(broadSummary.delivered_notification_count > 0, 'Broad dispatcher should deliver eligible notifications');
  assert(broadSummary.failed_notification_count === 0, 'Broad dispatcher should not fail on dry-run success');
  const captureAfterBroad = fs.existsSync(capturePath)
    ? fs.readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;
  assert(captureAfterBroad > captureBeforeBroad, 'Broad dispatcher should invoke CLI for eligible notifications');

  const broadSilentAfter = await getTaskNotificationsByTaskId(broadSilent.task.task_id);
  assert(broadSilentAfter.every((notification) => notification.delivery_state === 'pending'), 'Broad silent notifications should remain pending');
  const broadEligibleAfter = await getTaskNotificationsByTaskId(broadEligible.task.task_id);
  assert(broadEligibleAfter.some((notification) => notification.delivery_state === 'delivered'), 'Broad eligible notifications should be delivered');

  const schemaTasks = tableColumns(db, 'tasks');
  const schemaNotifications = tableColumns(db, 'task_notifications');

  console.log(JSON.stringify({
    status: 'pass',
    schema: {
      tasks: schemaTasks,
      task_notifications: schemaNotifications,
    },
    cases,
    guard: {
      blocked_status: blockedDispatch.status,
      override_status: overrideDispatch.status,
      override_attempt: overrideLatestAttempt,
    },
    broad_summary: broadSummary,
    capture_count: captureAfterBroad,
    persisted_db_path: dbPath,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE

# Confirm the schema columns were actually persisted to the temp billing DB file.
sqlite3 "$TMP_DIR/billing.sqlite" "pragma table_info(tasks);" >/dev/null
sqlite3 "$TMP_DIR/billing.sqlite" "pragma table_info(task_notifications);" >/dev/null

echo "PASS"
