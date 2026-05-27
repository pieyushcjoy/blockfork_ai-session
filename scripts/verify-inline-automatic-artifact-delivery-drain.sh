#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-auto-artifact-XXXXXX)"
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

mkdir -p "$TMP_DIR/workspace" "$TMP_DIR/bin" "$TMP_DIR/state/service-env" "$TMP_DIR/public"
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
    fileMessageId: `file_${Math.floor(Math.random() * 100000)}`,
    chatId: target,
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

function createFakeOpenClawConfig(tmpDir) {
  const stateDir = path.join(tmpDir, 'state');
  const configPath = path.join(stateDir, 'openclaw.json');
  fs.writeFileSync(configPath, JSON.stringify({
    service: 'ai.openclaw.cleanbench',
    profile: 'cleanbench',
    stateDir,
  }, null, 2));
  return configPath;
}

async function main() {
  const repoRoot = process.argv[2];
  const tmpDir = process.argv[3];
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const cliBin = path.join(tmpDir, 'bin', 'openclaw');
  const envFile = path.join(tmpDir, 'state/service-env/ai.openclaw.cleanbench.env');
  const configPath = createFakeOpenClawConfig(tmpDir);
  const stateDir = path.join(tmpDir, 'state');

  process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = workspaceRoot;
  process.env.BLOCKFORK_NOTIFICATION_TRANSPORT = 'openclaw_cli';
  process.env.BLOCKFORK_OPENCLAW_CLI_BIN = cliBin;
  process.env.BLOCKFORK_OPENCLAW_CLI_DRY_RUN = '0';
  process.env.BLOCKFORK_OPENCLAW_CLI_TIMEOUT_MS = '5000';
  process.env.BLOCKFORK_ARTIFACT_DELIVERY_RELAY_LABEL = 'cleanbench';
  process.chdir(tmpDir);

  const runtime = require(path.join(tmpDir, 'server.js'));
  const db = await runtime.ensureBillingDb();

  await runtime.upsertOpenClawRelayConfig({
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
    notes: 'automatic artifact delivery verifier relay',
  }, { timestamp: new Date().toISOString() });

  const doctor = await runtime.runOpenClawRelayDoctor('cleanbench', { probe: true, timeoutMs: 5000 });
  assert(doctor.readiness === 'ready', `Expected cleanbench relay to be ready, got ${doctor.readiness}`);
  assert(doctor.probe && doctor.probe.ok === true, 'Cleanbench relay probe should succeed');

  async function createTargetedSession(label, withDeliveryTarget = true) {
    const sessionBase = await runtime.createSessionRecord({
      user_id: `artifact_delivery_${label}_${Date.now()}`,
    });
    const liveKey = await runtime.getOrCreateLiveKeyForSession(sessionBase, {
      user_id: sessionBase.user_id || null,
    });
    if (withDeliveryTarget) {
      await runtime.bindLiveKeyDeliveryTarget(liveKey.id, {
        delivery_target: {
          channel: 'telegram',
          chat_id: '8407120350',
          thread_id: null,
        },
      }, { timestamp: new Date().toISOString() });
    }
    const activeSession = await runtime.createLiveKeySessionRecord(db, liveKey, sessionBase.ttl_selected);
    return { session: activeSession, liveKey };
  }

  async function createArtifactTask(label, objectiveText, withDeliveryTarget = true) {
    const sessionPack = await createTargetedSession(label, withDeliveryTarget);
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
    return { sessionPack, task, execution, requestId };
  }

  async function deliveryAttemptCount(notificationId) {
    const attempts = await runtime.getNotificationDeliveryAttemptsByNotificationId(notificationId, { limit: 20 });
    return attempts.length;
  }

  const happy = await createArtifactTask(
    'happy',
    'Create a markdown file named execution-lessons.md with a short 6-bullet summary of what makes technical execution reliable in long-running infrastructure projects.'
  );
  const happyResult = await runtime.materializeVerifiedArtifactForExecution(happy.execution.execution_id, 'I have the request and will create the artifact.', {
    requestId: happy.requestId,
    actorSource: 'runtime',
    relayLabel: 'cleanbench',
  });
  assert(happyResult.ok === true, `Happy-path materialization should succeed, got ${happyResult.reason || 'unknown'}`);
  const happyWorkspace = happyResult.workspace;
  await runtime.transitionExecution(happy.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    requestId: happy.requestId,
    actorSource: 'runtime',
    reasonCode: 'execution_completed',
  });
  await runtime.transitionTask(happy.task.task_id, runtime.TASK_STATES.COMPLETED, {
    executionId: happy.execution.execution_id,
    requestId: happy.requestId,
    actorSource: 'runtime',
    reasonCode: 'task_completed',
  });

  const happyArtifact = await runtime.getExecutionArtifactByExecutionId(happy.execution.execution_id);
  assert(happyArtifact, 'Happy-path artifact row should exist');
  const happyNotification = await runtime.getTaskNotificationByArtifactId(happyArtifact.artifact_id);
  assert(String(happyArtifact.verification_state || '') === runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Happy-path artifact should be verified');
  assert(String(happyArtifact.delivery_confirmed || 0) === '1', 'Happy-path artifact should be marked delivery confirmed');
  assert(happyNotification, 'Happy-path artifact delivery notification should exist');
  assert(String(happyNotification.notification_kind || '') === 'artifact_delivery', 'Happy-path notification kind mismatch');
  assert(String(happyNotification.delivery_state || '') === runtime.TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Happy-path delivery should be delivered');

  const happyAttempt = await runtime.getNotificationDeliveryAttemptByNotificationId(happyNotification.notification_id);
  assert(happyAttempt && happyAttempt.success === true, 'Happy-path delivery attempt should succeed');
  assert(happyAttempt.dry_run === false, 'Happy-path delivery should be a real send in the verifier');
  assert(happyAttempt.handled_by === 'plugin', 'Happy-path delivery should be handled by plugin');
  assert(happyAttempt.delivered_file_message_id, 'Happy-path delivery should persist a file message id');
  assert(String(happyAttempt.artifact_path || '').includes('.blockfork-artifact-deliveries'), 'Happy-path delivery should use a relay-safe staged copy');

  const happyAttemptCount = await deliveryAttemptCount(happyNotification.notification_id);
  const duplicateTrigger = await runtime.attemptAutomaticArtifactDeliveryForExecution(happy.execution.execution_id, {
    relayLabel: 'cleanbench',
  });
  assert(duplicateTrigger.ok === true && duplicateTrigger.skipped === true, 'Duplicate automatic delivery trigger should skip a delivered artifact');
  const happyAttemptCountAfterDuplicate = await deliveryAttemptCount(happyNotification.notification_id);
  assert(happyAttemptCountAfterDuplicate === happyAttemptCount, 'Duplicate trigger should not create a second delivery attempt');

  const unverified = await createArtifactTask(
    'unverified',
    'Create a markdown file named unverified-artifact.md with a short summary of safe delivery.'
  );
  const unverifiedWorkspace = happyWorkspace;
  const unverifiedPath = path.join(workspaceRoot, 'artifacts', unverified.execution.execution_id, 'unverified-artifact.md');
  writeText(unverifiedPath, '# Draft\n\nThis is only a draft.\n');
  await runtime.attachExecutionWorkspace(unverified.execution.execution_id, unverifiedWorkspace.workspace_id, {
    requestId: unverified.requestId,
    actorSource: 'runtime',
    reasonCode: 'execution_workspace_bound',
  });
  await runtime.createExecutionArtifactRecord({
    executionId: unverified.execution.execution_id,
    workspaceId: unverifiedWorkspace.workspace_id,
    declaredPath: unverifiedPath,
    canonicalPath: unverifiedPath,
    verificationState: runtime.ARTIFACT_VERIFICATION_STATES.PENDING,
    deliveryRequested: false,
    deliveryConfirmed: false,
    reasonCode: 'artifact_file_materialized',
    artifactFilename: 'unverified-artifact.md',
    artifactType: 'markdown',
    contentHash: crypto.createHash('sha256').update(fs.readFileSync(unverifiedPath, 'utf8')).digest('hex'),
    byteSize: fs.statSync(unverifiedPath).size,
    requestId: unverified.requestId,
    actorSource: 'runtime',
    timestamp: new Date().toISOString(),
  });
  const unverifiedAttempt = await runtime.attemptAutomaticArtifactDeliveryForExecution(unverified.execution.execution_id, {
    relayLabel: 'cleanbench',
    autoDeliver: false,
  });
  assert(unverifiedAttempt.ok === false, 'Unverified artifact should not auto-deliver');
  assert(unverifiedAttempt.reason === 'artifact_not_verified', `Unexpected unverified reason: ${unverifiedAttempt.reason}`);
  const unverifiedArtifact = await runtime.getExecutionArtifactByExecutionId(unverified.execution.execution_id);
  const unverifiedNotification = unverifiedArtifact ? await runtime.getTaskNotificationByArtifactId(unverifiedArtifact.artifact_id) : null;
  if (unverifiedNotification) {
    const count = await deliveryAttemptCount(unverifiedNotification.notification_id);
    assert(count === 0, 'Unverified artifact should not create delivery attempts');
  }

  const lowConfidence = await createArtifactTask(
    'low-confidence',
    'Create a file named low-confidence.md with six brief items about infrastructure reliability.'
  );
  const lowPath = path.join(workspaceRoot, 'artifacts', lowConfidence.execution.execution_id, 'low-confidence.md');
  writeText(lowPath, "I couldn't verify creation of low-confidence.md, but here is a markdown draft you can save manually:\n");
  await runtime.attachExecutionWorkspace(lowConfidence.execution.execution_id, happyWorkspace.workspace_id, {
    requestId: lowConfidence.requestId,
    actorSource: 'runtime',
    reasonCode: 'execution_workspace_bound',
  });
  await runtime.createExecutionArtifactRecord({
    executionId: lowConfidence.execution.execution_id,
    workspaceId: happyWorkspace.workspace_id,
    declaredPath: lowPath,
    canonicalPath: lowPath,
    verificationState: runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED,
    deliveryRequested: false,
    deliveryConfirmed: false,
    reasonCode: 'artifact_file_verified',
    artifactFilename: 'low-confidence.md',
    artifactType: 'markdown',
    contentHash: crypto.createHash('sha256').update(fs.readFileSync(lowPath, 'utf8')).digest('hex'),
    byteSize: fs.statSync(lowPath).size,
    requestId: lowConfidence.requestId,
    actorSource: 'runtime',
    timestamp: new Date().toISOString(),
  });
  const lowAssessment = await runtime.syncTaskArtifactAssessment(lowConfidence.execution.execution_id, {
    completionText: 'I have the request and will create the artifact.',
  });
  assert(lowAssessment, 'Low-confidence assessment should exist');
  assert(String(lowAssessment.confidence_band || '') !== runtime.TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH, 'Low-confidence assessment should not be high confidence');
  const lowAttempt = await runtime.attemptAutomaticArtifactDeliveryForExecution(lowConfidence.execution.execution_id, {
    relayLabel: 'cleanbench',
    artifactPath: lowPath,
    autoDeliver: false,
  });
  assert(lowAttempt.ok === false, 'Low-confidence artifact should not auto-deliver');
  assert(lowAttempt.reason === 'artifact_semantic_verification_failed' || lowAttempt.reason === 'artifact_low_confidence', `Unexpected low-confidence reason: ${lowAttempt.reason}`);
  const lowNotification = await runtime.getTaskNotificationByArtifactId((await runtime.getExecutionArtifactByExecutionId(lowConfidence.execution.execution_id)).artifact_id);
  if (lowNotification) {
    const count = await deliveryAttemptCount(lowNotification.notification_id);
    assert(count === 0, 'Low-confidence artifact should not create delivery attempts');
  }

  const relayBlocked = await createArtifactTask(
    'relay-blocked',
    'Create a markdown file named relay-blocked.md with a short 6-bullet summary of why consistency matters in difficult projects.'
  );
  const relayBlockedResult = await runtime.materializeVerifiedArtifactForExecution(relayBlocked.execution.execution_id, 'I have the request and will create the artifact.', {
    requestId: relayBlocked.requestId,
    actorSource: 'runtime',
    autoDeliver: false,
    relayLabel: 'cleanbench',
  });
  assert(relayBlockedResult.ok === true, 'Relay-blocked artifact should materialize');
  const relayBlockedArtifact = await runtime.getExecutionArtifactByExecutionId(relayBlocked.execution.execution_id);
  const relayBlockedNotification = await runtime.getTaskNotificationByArtifactId(relayBlockedArtifact.artifact_id);
  assert(relayBlockedNotification, 'Relay-blocked artifact notification should exist');
  const relayBlockedStageDir = path.join(workspaceRoot, '.blockfork-artifact-deliveries', relayBlocked.execution.execution_id);
  fs.mkdirSync(relayBlockedStageDir, { recursive: true });
  const relayBlockedStagePath = path.join(relayBlockedStageDir, 'relay-blocked.md');
  fs.copyFileSync(relayBlockedArtifact.canonical_path, relayBlockedStagePath);
  const brokenAttempt = await runtime.attemptAutomaticArtifactDeliveryForExecution(relayBlocked.execution.execution_id, {
    relayLabel: 'broken',
    autoDeliver: false,
  });
  assert(brokenAttempt.ok === false, 'Broken relay should block automatic delivery');
  assert(brokenAttempt.reason === 'relay_not_ready' || brokenAttempt.reason === 'relay_config_not_found', `Unexpected broken relay reason: ${brokenAttempt.reason}`);

  const noTarget = await createArtifactTask(
    'missing-target',
    'Create a markdown file named no-target.md with a short 6-bullet summary of why consistency matters in difficult projects.',
    false
  );
  const noTargetResult = await runtime.materializeVerifiedArtifactForExecution(noTarget.execution.execution_id, 'I have the request and will create the artifact.', {
    requestId: noTarget.requestId,
    actorSource: 'runtime',
    autoDeliver: false,
    relayLabel: 'cleanbench',
  });
  assert(noTargetResult.ok === true, 'Missing-target artifact should still materialize');
  const noTargetAttempt = await runtime.attemptAutomaticArtifactDeliveryForExecution(noTarget.execution.execution_id, {
    relayLabel: 'cleanbench',
    autoDeliver: false,
  });
  assert(noTargetAttempt.ok === false, 'Missing-target artifact should not auto-deliver');
  assert(noTargetAttempt.delivery && noTargetAttempt.delivery.status === 'blocked', 'Missing-target artifact should be blocked');
  assert(noTargetAttempt.delivery.reason_code === 'no_delivery_target', `Unexpected missing-target reason: ${noTargetAttempt.delivery && noTargetAttempt.delivery.reason_code}`);

  const textSession = await createTargetedSession('text-only', true);
  const textTask = (await runtime.createTaskRecord({
    sessionId: textSession.session.session_id,
    requestId: makeId('text_req'),
    idempotencyKey: makeId('text_task'),
    objectiveText: 'Reply with exactly DONE and nothing else.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;
  const textExecution = (await runtime.createExecutionRecord({
    sessionId: textSession.session.session_id,
    requestId: `${textTask.request_id}_exec`,
    idempotencyKey: makeId('text_exec'),
    taskId: textTask.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;
  const textAttempt = await runtime.attemptAutomaticArtifactDeliveryForExecution(textExecution.execution_id, {
    relayLabel: 'cleanbench',
    autoDeliver: false,
  });
  assert(textAttempt.ok === true && textAttempt.skipped === true, 'Text-only prompt should not trigger automatic artifact delivery');

  const exactDryRun = await runtime.dispatchArtifactDeliveryById(relayBlockedNotification.notification_id, {
    relayLabel: 'cleanbench',
    commandPath: cliBin,
    dryRun: true,
    artifactPath: relayBlockedStagePath,
  });
  assert(exactDryRun.status === 'delivered', `Exact dry-run delivery should succeed, got ${exactDryRun.status}`);
  assert(exactDryRun.adapter_result && exactDryRun.adapter_result.ok === true, 'Exact dry-run adapter should succeed');
  assert(exactDryRun.adapter_result.stdout_json.payload.mediaUrl === relayBlockedStagePath, 'Exact dry-run should use the staged artifact path');
  const relayBlockedAttempts = await runtime.getNotificationDeliveryAttemptsByNotificationId(relayBlockedNotification.notification_id, { limit: 20 });
  assert(relayBlockedAttempts.length >= 1, 'Expected the exact dry-run delivery to persist an attempt');
  assert(relayBlockedAttempts.some((attempt) => attempt.dry_run === true), 'Expected at least one dry-run artifact delivery attempt');

  console.log(JSON.stringify({
    ok: true,
    happy_notification_id: happyNotification.notification_id,
    happy_attempt_id: happyAttempt.attempt_id,
    relay_label: 'cleanbench',
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
