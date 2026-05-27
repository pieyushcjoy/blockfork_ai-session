#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-artifact-delivery-XXXXXX)"
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

mkdir -p "$TMP_DIR/workspace" "$TMP_DIR/bin" "$TMP_DIR/public" "$TMP_DIR/state/service-env"
cp "$REPO_ROOT/server.js" "$TMP_DIR/server.js"
cp "$REPO_ROOT/package.json" "$TMP_DIR/package.json"
ln -s "$REPO_ROOT/node_modules" "$TMP_DIR/node_modules"

cat > "$TMP_DIR/bin/openclaw" <<'NODE'
#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.FAKE_OPENCLAW_MODE || (args.includes('--dry-run') ? 'dry-run' : 'real');

function readFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '') : '';
}

const target = readFlag('--target');
const threadId = readFlag('--thread-id');
const message = readFlag('--message');
const media = readFlag('--media');
const forceDocument = args.includes('--force-document');

if (mode === 'failure') {
  console.error('simulated openclaw delivery failure');
  process.exit(17);
}

if (mode === 'dry-run') {
  process.stdout.write(`${JSON.stringify({
    action: 'send',
    channel: 'telegram',
    dryRun: true,
    handledBy: 'core',
    payload: {
      channel: 'telegram',
      to: `telegram:${target}`,
      via: 'direct',
      dryRun: true,
      message,
      mediaUrl: media || null,
      mediaUrls: media ? [media] : [],
      forceDocument,
      ...(threadId ? { threadId } : {}),
    },
  })}\n`);
  process.exit(0);
}

process.stdout.write(`${JSON.stringify({
  action: 'send',
  channel: 'telegram',
  dryRun: false,
  handledBy: 'plugin',
  payload: {
    ok: true,
    messageId: `msg_${Math.floor(Math.random() * 100000)}`,
    chatId: target,
    fileMessageId: `file_${Math.floor(Math.random() * 100000)}`,
    mediaUrl: media || null,
    mediaUrls: media ? [media] : [],
    forceDocument,
    ...(threadId ? { threadId } : {}),
  },
})}\n`);
NODE

chmod +x "$TMP_DIR/bin/openclaw"

cat > "$TMP_DIR/state/service-env/ai.openclaw.cleanbench.env" <<'EOF'
OPENCLAW_TOKEN=stub
EOF

node - "$REPO_ROOT" "$TMP_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

async function main() {
  const repoRoot = process.argv[2];
  const tmpDir = process.argv[3];
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const cliBin = path.join(tmpDir, 'bin', 'openclaw');
  const envFile = path.join(tmpDir, 'state/service-env/ai.openclaw.cleanbench.env');
  const configPath = path.join(tmpDir, 'state/openclaw.json');
  const stateDir = path.join(tmpDir, 'state');

  fs.writeFileSync(configPath, JSON.stringify({
    service: 'ai.openclaw.cleanbench',
    profile: 'cleanbench',
    stateDir,
  }, null, 2));

  process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = workspaceRoot;
  process.env.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
  process.env.BLOCKFORK_OPENCLAW_CLI_BIN = cliBin;
  process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = '1';
  process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS = '5000';
  process.chdir(tmpDir);

  const runtime = require(path.join(tmpDir, 'server.js'));
  const db = await runtime.ensureBillingDb();

  const cleanbenchRelay = await runtime.upsertOpenClawRelayConfig({
    relay_label: 'cleanbench',
    transport: 'openclaw_cli',
    service_name: 'ai.openclaw.cleanbench',
    profile_name: 'cleanbench',
    cli_bin: cliBin,
    env_file: envFile,
    config_path: configPath,
    state_dir: stateDir,
    chat_id: '8407120350',
    thread_id: null,
    probe_message: 'BlockFork relay doctor dry-run',
    notes: 'artifact delivery verifier relay',
  }, { timestamp: new Date().toISOString() });
  assert(cleanbenchRelay.relay_label === 'cleanbench', 'Relay config should save cleanbench');

  const doctor = await runtime.runOpenClawRelayDoctor('cleanbench', { probe: true, timeoutMs: 5000 });
  assert(doctor.readiness === 'ready', `Expected cleanbench relay readiness ready, got ${doctor.readiness}`);
  assert(doctor.probe && doctor.probe.ok === true, 'Relay doctor probe should succeed');

  async function createTargetedSession(label) {
    const sessionBase = await runtime.createSessionRecord({
      user_id: `artifact_delivery_${label}_${Date.now()}`,
    });
    const liveKey = await runtime.getOrCreateLiveKeyForSession(sessionBase, {
      user_id: sessionBase.user_id || null,
    });
    await runtime.bindLiveKeyDeliveryTarget(liveKey.id, {
      delivery_target: {
        channel: 'telegram',
        chat_id: '8407120350',
        thread_id: null,
      },
    }, { timestamp: new Date().toISOString() });
    const activeSession = await runtime.createLiveKeySessionRecord(db, liveKey, sessionBase.ttl_selected);
    return { session: activeSession, liveKey };
  }

  async function createArtifactTask(label, objectiveText) {
    const sessionPack = await createTargetedSession(label);
    const requestId = makeId(`artifact_req_${label}`);
    const task = (await runtime.createTaskRecord({
      sessionId: sessionPack.session.session_id,
      requestId,
      idempotencyKey: makeId(`artifact_task_${label}`),
      objectiveText,
      actorSource: 'test',
      reasonCode: 'task_received',
    })).task;
    const execution = (await runtime.createExecutionRecord({
      sessionId: sessionPack.session.session_id,
      requestId: `${requestId}_exec`,
      idempotencyKey: makeId(`artifact_exec_${label}`),
      taskId: task.task_id,
      actorSource: 'test',
      reasonCode: 'request_admitted',
    })).execution;
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
    return { sessionPack, task, execution };
  }

  async function createSimpleTask(label, objectiveText) {
    const sessionPack = await createTargetedSession(label);
    const requestId = makeId(`simple_req_${label}`);
    const task = (await runtime.createTaskRecord({
      sessionId: sessionPack.session.session_id,
      requestId,
      idempotencyKey: makeId(`simple_task_${label}`),
      objectiveText,
      actorSource: 'test',
      reasonCode: 'task_received',
    })).task;
    const execution = (await runtime.createExecutionRecord({
      sessionId: sessionPack.session.session_id,
      requestId: `${requestId}_exec`,
      idempotencyKey: makeId(`simple_exec_${label}`),
      taskId: task.task_id,
      actorSource: 'test',
      reasonCode: 'request_admitted',
    })).execution;
    return { sessionPack, task, execution };
  }

  const verifiedContent = [
    '# Artifact Delivery',
    '',
    '- Delivery works only after the artifact is verified.',
    '- The relay should be explicit and controlled.',
    '- File attachments should preserve workspace safety.',
    '- Delivery evidence must be recorded separately from artifact truth.',
    '- Retry paths should not corrupt the completed artifact.',
  ].join('\n');

  const happy = await createArtifactTask(
    'happy',
    'Create a markdown file named artifact-delivery.md with a short 5-bullet summary of why verified artifacts should be delivered safely to Telegram.'
  );
  const happyMaterialized = await runtime.materializeVerifiedArtifactForExecution(happy.execution.execution_id, 'I have the request and will create the artifact.', {
    filename: 'artifact-delivery.md',
    artifactContent: verifiedContent,
    actorSource: 'test',
    autoDeliver: false,
    timestamp: new Date().toISOString(),
  });
  assert(happyMaterialized.ok === true, 'Happy path artifact materialization should succeed');
  await runtime.transitionExecution(happy.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    requestId: happy.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });

  const happyArtifact = await runtime.getExecutionArtifactByExecutionId(happy.execution.execution_id);
  assert(happyArtifact, 'Happy path artifact row missing');
  assert(happyArtifact.verification_state === 'verified', 'Happy path artifact should be verified');
  const happyNotification = await runtime.getTaskNotificationByArtifactId(happyArtifact.artifact_id);
  assert(happyNotification, 'Happy path artifact delivery notification missing');
  assert(happyNotification.notification_kind === 'artifact_delivery', 'Artifact delivery notification kind mismatch');
  assert(happyNotification.proactive_eligible === 0, 'Artifact delivery notification should be controlled only');
  assert(String(happyNotification.payload.artifact_id || '') === String(happyArtifact.artifact_id || ''), 'Artifact id should persist in notification payload');
  assert(String(happyNotification.payload.artifact_path || '') === String(happyArtifact.canonical_path || ''), 'Artifact path should persist in notification payload');
  assert(happyNotification.delivery_state === 'pending', 'Artifact delivery notification should begin pending');

  const dryRunResult = await runtime.dispatchArtifactDeliveryById(happyNotification.notification_id, {
    relayLabel: 'cleanbench',
    dryRun: true,
    commandPath: cliBin,
    timeoutMs: 5000,
    overrideEligibility: true,
    allowDelivered: false,
  });
  assert(dryRunResult.status === 'delivered', 'Dry-run artifact delivery should be treated as delivered in the verifier path');
  assert(dryRunResult.adapter_result && dryRunResult.adapter_result.ok === true, 'Dry-run delivery should succeed');
  assert(dryRunResult.adapter_result.stdout_json && dryRunResult.adapter_result.stdout_json.dryRun === true, 'Dry-run output should confirm dryRun=true');
  assert(String(dryRunResult.adapter_result.stdout_json.payload.mediaUrl || '') === String(happyArtifact.canonical_path || ''), 'Dry-run should include the artifact media path');
  const dryRunAttempt = await runtime.getNotificationDeliveryAttemptByNotificationId(happyNotification.notification_id);
  assert(dryRunAttempt, 'Dry-run delivery attempt missing');
  assert(dryRunAttempt.artifact_id === happyArtifact.artifact_id, 'Dry-run attempt should persist artifact_id');
  assert(dryRunAttempt.artifact_path === happyArtifact.canonical_path, 'Dry-run attempt should persist artifact_path');
  assert(dryRunAttempt.relay_label === 'cleanbench', 'Dry-run attempt should persist relay label');
  assert(dryRunAttempt.media_kind === 'markdown', 'Dry-run attempt should persist media kind');
  assert(dryRunAttempt.handled_by === 'core', 'Dry-run attempt should persist handledBy');
  assert(dryRunAttempt.success === true, 'Dry-run attempt should succeed');
  const dryRunNotification = await runtime.getTaskNotificationByArtifactId(happyArtifact.artifact_id);
  assert(dryRunNotification.delivery_state === 'delivered', 'Dry-run artifact delivery should mark notification delivered');

  process.env.FAKE_OPENCLAW_MODE = 'real';
  const real = await createArtifactTask(
    'real',
    'Create a markdown file named artifact-receipt.md with a short 5-bullet summary of verified artifact delivery.'
  );
  const realMaterialized = await runtime.materializeVerifiedArtifactForExecution(real.execution.execution_id, 'I have the request and will create the artifact.', {
    filename: 'artifact-receipt.md',
    artifactContent: verifiedContent,
    actorSource: 'test',
    autoDeliver: false,
    timestamp: new Date().toISOString(),
  });
  assert(realMaterialized.ok === true, 'Real send artifact materialization should succeed');
  await runtime.transitionExecution(real.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    requestId: real.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });
  const realArtifact = await runtime.getExecutionArtifactByExecutionId(real.execution.execution_id);
  const realNotification = await runtime.getTaskNotificationByArtifactId(realArtifact.artifact_id);
  const realDeliveryResult = await runtime.dispatchArtifactDeliveryById(realNotification.notification_id, {
    relayLabel: 'cleanbench',
    dryRun: false,
    commandPath: cliBin,
    timeoutMs: 5000,
    maxRealSends: 1,
    overrideEligibility: true,
    allowDelivered: false,
  });
  assert(realDeliveryResult.status === 'delivered', `Real artifact delivery should be delivered, got ${realDeliveryResult.status}`);
  assert(realDeliveryResult.adapter_result && realDeliveryResult.adapter_result.ok === true, 'Real delivery should succeed');
  assert(realDeliveryResult.adapter_result.stdout_json && realDeliveryResult.adapter_result.stdout_json.handledBy === 'plugin', 'Real delivery should be handled by plugin');
  assert(String(realDeliveryResult.adapter_result.stdout_json.payload.messageId || '') !== '', 'Real delivery should include messageId');
  const realAttempt = await runtime.getNotificationDeliveryAttemptByNotificationId(realNotification.notification_id);
  assert(realAttempt, 'Real delivery attempt missing');
  assert(realAttempt.artifact_id === realArtifact.artifact_id, 'Real delivery attempt should persist artifact_id');
  assert(realAttempt.artifact_path === realArtifact.canonical_path, 'Real delivery attempt should persist artifact_path');
  assert(realAttempt.relay_label === 'cleanbench', 'Real delivery attempt should persist relay label');
  assert(realAttempt.media_kind === 'markdown', 'Real delivery attempt should persist media kind');
  assert(realAttempt.handled_by === 'plugin', 'Real delivery attempt should persist handledBy=plugin');
  assert(realAttempt.success === true, 'Real delivery attempt should succeed');
  const realDeliveredNotification = await runtime.getTaskNotificationByArtifactId(realArtifact.artifact_id);
  assert(realDeliveredNotification.delivery_state === 'delivered', 'Real artifact delivery should mark notification delivered');
  assert(String(realDeliveredNotification.delivered_message_id || '') !== '', 'Real artifact delivery should persist delivered message id');

  process.env.FAKE_OPENCLAW_MODE = 'failure';
  const failure = await createArtifactTask(
    'failure',
    'Create a markdown file named artifact-failure.md with a short 5-bullet summary of why retries should be isolated.'
  );
  const failureMaterialized = await runtime.materializeVerifiedArtifactForExecution(failure.execution.execution_id, 'I have the request and will create the artifact.', {
    filename: 'artifact-failure.md',
    artifactContent: verifiedContent,
    actorSource: 'test',
    autoDeliver: false,
    timestamp: new Date().toISOString(),
  });
  assert(failureMaterialized.ok === true, 'Failure-path artifact materialization should succeed');
  await runtime.transitionExecution(failure.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    requestId: failure.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });
  const failureArtifact = await runtime.getExecutionArtifactByExecutionId(failure.execution.execution_id);
  const failureNotification = await runtime.getTaskNotificationByArtifactId(failureArtifact.artifact_id);
  const failureDeliveryResult = await runtime.dispatchArtifactDeliveryById(failureNotification.notification_id, {
    relayLabel: 'cleanbench',
    dryRun: false,
    commandPath: cliBin,
    timeoutMs: 5000,
    maxRealSends: 1,
    overrideEligibility: true,
    allowDelivered: false,
  });
  assert(failureDeliveryResult.status === 'retryable' || failureDeliveryResult.status === 'failed', 'Failure-path artifact delivery should not succeed');
  assert(failureDeliveryResult.adapter_result && failureDeliveryResult.adapter_result.ok === false, 'Failure-path delivery should fail');
  const failureAttempt = await runtime.getNotificationDeliveryAttemptByNotificationId(failureNotification.notification_id);
  assert(failureAttempt, 'Failure-path delivery attempt missing');
  assert(failureAttempt.success === false, 'Failure-path attempt should record failure');
  const failureTask = await runtime.getTaskByExecutionId(failure.execution.execution_id);
  assert(failureTask.current_state === 'completed', 'Artifact delivery failure must not corrupt task completion truth');

  process.env.FAKE_OPENCLAW_MODE = 'dry-run';
  const unverified = await createArtifactTask(
    'unverified',
    'Create a markdown file named unverified-delivery.md with a short 5-bullet summary of cautious delivery.'
  );
  const unverifiedWorkspace = await runtime.findOrCreateWorkspaceBinding(workspaceRoot, 'env:test', { timestamp: new Date().toISOString() });
  const unverifiedPath = path.join(workspaceRoot, 'artifacts', unverified.execution.execution_id, 'unverified-delivery.md');
  writeText(unverifiedPath, '# Unverified\n\n- one\n- two\n');
  await runtime.attachExecutionWorkspace(unverified.execution.execution_id, unverifiedWorkspace.workspace_id, {
    requestId: unverified.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'execution_workspace_bound',
  });
  await runtime.createExecutionArtifactRecord({
    executionId: unverified.execution.execution_id,
    workspaceId: unverifiedWorkspace.workspace_id,
    declaredPath: unverifiedPath,
    canonicalPath: unverifiedPath,
    verificationState: runtime.ARTIFACT_VERIFICATION_STATES.PENDING,
    reasonCode: 'artifact_record_created',
    artifactFilename: 'unverified-delivery.md',
    artifactType: 'markdown',
    contentHash: crypto.createHash('sha256').update(fs.readFileSync(unverifiedPath, 'utf8')).digest('hex'),
    byteSize: fs.statSync(unverifiedPath).size,
    requestId: unverified.execution.last_request_id,
    actorSource: 'test',
    timestamp: new Date().toISOString(),
  });
  const unverifiedEligibility = await runtime.assessArtifactDeliveryEligibility(unverified.execution.execution_id);
  assert(unverifiedEligibility.ok === false, 'Unverified artifact should not be delivery eligible');
  assert(String(unverifiedEligibility.reason || '') === 'artifact_not_verified', `Unexpected unverified reason: ${unverifiedEligibility.reason}`);

  const missing = await createArtifactTask(
    'missing',
    'Create a markdown file named missing-delivery.md with a short 5-bullet summary.'
  );
  const missingWorkspace = await runtime.findOrCreateWorkspaceBinding(workspaceRoot, 'env:test', { timestamp: new Date().toISOString() });
  const missingPath = path.join(workspaceRoot, 'artifacts', missing.execution.execution_id, 'missing-delivery.md');
  await runtime.attachExecutionWorkspace(missing.execution.execution_id, missingWorkspace.workspace_id, {
    requestId: missing.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'execution_workspace_bound',
  });
  await runtime.createExecutionArtifactRecord({
    executionId: missing.execution.execution_id,
    workspaceId: missingWorkspace.workspace_id,
    declaredPath: missingPath,
    canonicalPath: missingPath,
    verificationState: runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED,
    reasonCode: 'artifact_file_verified',
    artifactFilename: 'missing-delivery.md',
    artifactType: 'markdown',
    contentHash: crypto.createHash('sha256').update('missing', 'utf8').digest('hex'),
    byteSize: 7,
    requestId: missing.execution.last_request_id,
    actorSource: 'test',
    timestamp: new Date().toISOString(),
  });
  const missingEligibility = await runtime.assessArtifactDeliveryEligibility(missing.execution.execution_id);
  assert(missingEligibility.ok === false, 'Missing file should not be delivery eligible');
  assert(String(missingEligibility.reason || '') === 'artifact_path_not_found', `Unexpected missing-file reason: ${missingEligibility.reason}`);

  const unsafe = await createArtifactTask(
    'unsafe',
    'Create a markdown file named unsafe-delivery.md with a short 5-bullet summary.'
  );
  const unsafeWorkspace = await runtime.findOrCreateWorkspaceBinding(workspaceRoot, 'env:test', { timestamp: new Date().toISOString() });
  const unsafePath = path.join('/private/tmp', `unsafe-delivery-${crypto.randomUUID()}.md`);
  writeText(unsafePath, '# Unsafe\n\n- one\n- two\n- three\n- four\n- five\n');
  await runtime.attachExecutionWorkspace(unsafe.execution.execution_id, unsafeWorkspace.workspace_id, {
    requestId: unsafe.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'execution_workspace_bound',
  });
  await runtime.createExecutionArtifactRecord({
    executionId: unsafe.execution.execution_id,
    workspaceId: unsafeWorkspace.workspace_id,
    declaredPath: unsafePath,
    canonicalPath: unsafePath,
    verificationState: runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED,
    reasonCode: 'artifact_file_verified',
    artifactFilename: 'unsafe-delivery.md',
    artifactType: 'markdown',
    contentHash: crypto.createHash('sha256').update(fs.readFileSync(unsafePath, 'utf8')).digest('hex'),
    byteSize: fs.statSync(unsafePath).size,
    requestId: unsafe.execution.last_request_id,
    actorSource: 'test',
    timestamp: new Date().toISOString(),
  });
  const unsafeEligibility = await runtime.assessArtifactDeliveryEligibility(unsafe.execution.execution_id);
  assert(unsafeEligibility.ok === false, 'Unsafe path should not be delivery eligible');
  assert(String(unsafeEligibility.reason || '') === 'artifact_path_outside_workspace', `Unexpected unsafe-path reason: ${unsafeEligibility.reason}`);

  const low = await createArtifactTask(
    'low',
    'Create a markdown file named low-confidence-delivery.md with a short 5-bullet summary.'
  );
  const lowWorkspace = await runtime.findOrCreateWorkspaceBinding(workspaceRoot, 'env:test', { timestamp: new Date().toISOString() });
  const lowPath = path.join(workspaceRoot, 'artifacts', low.execution.execution_id, 'low-confidence-delivery.md');
  writeText(lowPath, 'Just a plain note that does not match the request.\n');
  await runtime.attachExecutionWorkspace(low.execution.execution_id, lowWorkspace.workspace_id, {
    requestId: low.execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'execution_workspace_bound',
  });
  await runtime.createExecutionArtifactRecord({
    executionId: low.execution.execution_id,
    workspaceId: lowWorkspace.workspace_id,
    declaredPath: lowPath,
    canonicalPath: lowPath,
    verificationState: runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED,
    reasonCode: 'artifact_file_verified',
    artifactFilename: 'low-confidence-delivery.md',
    artifactType: 'markdown',
    contentHash: crypto.createHash('sha256').update(fs.readFileSync(lowPath, 'utf8')).digest('hex'),
    byteSize: fs.statSync(lowPath).size,
    requestId: low.execution.last_request_id,
    actorSource: 'test',
    timestamp: new Date().toISOString(),
  });
  const lowAssessment = await runtime.getTaskArtifactAssessmentByTaskId(low.task.task_id);
  assert(lowAssessment && lowAssessment.confidence_band !== 'high', 'Low-confidence assessment should not be high');
  const lowEligibility = await runtime.assessArtifactDeliveryEligibility(low.execution.execution_id);
  assert(lowEligibility.ok === false, 'Low-confidence artifact should not be delivery eligible');
  assert(String(lowEligibility.reason || '') === 'artifact_low_confidence', `Unexpected low-confidence reason: ${lowEligibility.reason}`);

  const textOnly = await createSimpleTask(
    'text-only',
    'Reply with exactly DONE and nothing else.'
  );
  const textEligibility = await runtime.assessArtifactDeliveryEligibility(textOnly.execution.execution_id);
  assert(textEligibility.ok === true && textEligibility.skipped === true, 'Text-only prompt should not trigger artifact delivery');
  const textNotifications = await runtime.getTaskNotificationsByTaskId(textOnly.task.task_id);
  assert(textNotifications.every((notification) => notification.notification_kind !== 'artifact_delivery'), 'Text-only prompt should not create artifact delivery notifications');
  const nonArtifactNotification = (await runtime.getTaskNotificationsByTaskId(happy.task.task_id))
    .find((notification) => notification.notification_kind !== 'artifact_delivery');
  assert(nonArtifactNotification, 'Expected a non-artifact notification for exact-dispatch guard test');
  const textDispatchBlocked = await runtime.dispatchArtifactDeliveryById(nonArtifactNotification.notification_id, {
    relayLabel: 'cleanbench',
    dryRun: true,
    commandPath: cliBin,
    timeoutMs: 5000,
    overrideEligibility: true,
    allowDelivered: false,
  });
  assert(textDispatchBlocked.status === 'blocked', 'Text notification should be blocked from artifact delivery');
  assert(String(textDispatchBlocked.reason_code || '') === 'not_artifact_delivery_notification', `Unexpected text notification dispatch reason: ${textDispatchBlocked.reason_code}`);
  assert(textDispatchBlocked.attempt === null, 'Blocked text notification should not create a delivery attempt');

  const happySummary = await runtime.getTaskCompletionSummaryByTaskId(happy.task.task_id);
  assert(happySummary && happySummary.final_state === 'completed', 'Happy path task should be completed');
  assert(Array.isArray(happySummary.artifacts) && happySummary.artifacts.length > 0, 'Happy summary should include artifact evidence');

  const result = {
    status: 'pass',
    happy_path: {
      task_id: happy.task.task_id,
      execution_id: happy.execution.execution_id,
      artifact_id: happyArtifact.artifact_id,
      notification_id: happyNotification.notification_id,
    },
    real_path: {
      task_id: real.task.task_id,
      execution_id: real.execution.execution_id,
      artifact_id: realArtifact.artifact_id,
      notification_id: realNotification.notification_id,
    },
    failure_path: {
      task_id: failure.task.task_id,
      execution_id: failure.execution.execution_id,
      artifact_id: failureArtifact.artifact_id,
      notification_id: failureNotification.notification_id,
    },
    negative_cases: [
      { task_id: unverified.task.task_id, reason: unverifiedEligibility.reason },
      { task_id: missing.task.task_id, reason: missingEligibility.reason },
      { task_id: unsafe.task.task_id, reason: unsafeEligibility.reason },
      { task_id: low.task.task_id, reason: lowEligibility.reason },
    ],
    simple_prompt: {
      task_id: textOnly.task.task_id,
      notification_count: textNotifications.length,
    },
    checks: [
      'verified artifact becomes delivery-eligible',
      'unverified artifact is blocked',
      'missing file is blocked',
      'unsafe path is blocked',
      'low-confidence artifact is blocked',
      'text-only prompt does not trigger artifact delivery',
      'OpenClaw dry-run file delivery uses --media and --force-document',
      'delivery attempt is persisted',
      'delivery failure does not corrupt completion truth',
      'artifact success and artifact delivery success are separate',
    ],
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
NODE
