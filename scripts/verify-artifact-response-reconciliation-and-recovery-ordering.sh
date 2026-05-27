#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-artifact-response-reconciliation-XXXXXX)"
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

mkdir -p "$TMP_DIR/workspace" "$TMP_DIR/bin" "$TMP_DIR/state/service-env"
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
      ok: true,
      chatId: target,
      message,
      mediaUrl: media || null,
      forceDocument,
      dryRun: true,
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
    chatId: target,
    messageId: `msg_${Math.floor(Math.random() * 100000)}`,
    fileMessageId: `file_${Math.floor(Math.random() * 100000)}`,
    mediaUrl: media || null,
    forceDocument,
    ...(threadId ? { threadId } : {}),
  },
})}\n`);
NODE

chmod +x "$TMP_DIR/bin/openclaw"

cat > "$TMP_DIR/state/service-env/ai.openclaw.cleanbench.env" <<'EOF_ENV'
OPENCLAW_TOKEN=stub
EOF_ENV

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

function countMatches(text, pattern) {
  return String(text || '').match(pattern)?.length || 0;
}

function historyPrompt(previousFilename, currentPrompt, marker = '460') {
  return [
    `#448 Wed 2026-05-27 15:53 GMT+5:30 Onchain Hashira: Create a markdown file named ${previousFilename} with a short 5-bullet summary of what runtime delivery proved.`,
    `#${marker} Wed 2026-05-27 16:00 GMT+5:30 Onchain Hashira: ${currentPrompt}`,
  ].join(' ');
}

async function main() {
  const repoRoot = process.argv[2];
  const tmpDir = process.argv[3];
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const cliBin = path.join(tmpDir, 'bin', 'openclaw');
  const envFile = path.join(tmpDir, 'state/service-env/ai.openclaw.cleanbench.env');
  const stateDir = path.join(tmpDir, 'state');
  const configPath = path.join(stateDir, 'openclaw.json');

  fs.writeFileSync(configPath, JSON.stringify({
    service: 'ai.openclaw.cleanbench',
    profile: 'cleanbench',
    stateDir,
  }, null, 2));

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
    notes: 'artifact response reconciliation verifier relay',
  }, { timestamp: new Date().toISOString() });

  const doctor = await runtime.runOpenClawRelayDoctor('cleanbench', { probe: true, timeoutMs: 5000 });
  assert(doctor.readiness === 'ready', `Expected cleanbench relay to be ready, got ${doctor.readiness}`);
  assert(doctor.probe && doctor.probe.ok === true, 'Relay doctor probe should succeed');

  async function createTargetedSession(label, withDeliveryTarget = true) {
    const sessionBase = await runtime.createSessionRecord({
      user_id: `artifact_reconcile_${label}_${Date.now()}`,
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

  function readArtifact(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      content,
      bullets: countMatches(content, /^\s*-\s+/gm),
      steps: countMatches(content, /^\s*\d+\.\s+/gm),
      hash: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  }

  // Prompt 1: artifact-aware confirmation should replace clarification text.
  const prompt1 = 'Create a markdown file named phase-five-success-proof.md with a short 5-bullet summary of what BlockFork has successfully achieved in Phase 5.';
  const prompt1Task = await createArtifactTask('prompt1', prompt1, true);
  const clarification = 'Please provide the 5 key achievements.';
  const prompt1Result = await runtime.materializeVerifiedArtifactForExecution(prompt1Task.execution.execution_id, clarification, {
    requestId: prompt1Task.requestId,
    actorSource: 'runtime',
    autoDeliver: true,
    relayLabel: 'cleanbench',
    promptText: prompt1,
  });
  assert(prompt1Result.ok === true, `Prompt 1 materialization failed: ${prompt1Result.reason || 'unknown'}`);
  assert(String(prompt1Result.filename || '') === 'phase-five-success-proof.md', `Prompt 1 filename mismatch: ${prompt1Result.filename}`);
  const prompt1Artifact = await runtime.getExecutionArtifactByExecutionId(prompt1Task.execution.execution_id);
  assert(prompt1Artifact, 'Prompt 1 artifact row missing');
  assert(String(prompt1Artifact.artifact_filename || '') === 'phase-five-success-proof.md', 'Prompt 1 persisted filename mismatch');
  assert(String(prompt1Artifact.verification_state || '') === runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Prompt 1 artifact should be verified');
  assert(String(prompt1Artifact.delivery_confirmed || 0) === '1', 'Prompt 1 artifact should be delivery confirmed');
  const prompt1File = path.join(workspaceRoot, 'artifacts', prompt1Task.execution.execution_id, 'phase-five-success-proof.md');
  assert(fs.existsSync(prompt1File), 'Prompt 1 artifact file should exist');
  const prompt1ArtifactData = readArtifact(prompt1File);
  assert(prompt1ArtifactData.bullets === 5, `Prompt 1 should contain exactly 5 bullets, got ${prompt1ArtifactData.bullets}`);
  assert(prompt1ArtifactData.content.startsWith('# Phase Five Success Proof'), 'Prompt 1 should have a markdown heading');
  assert(prompt1ArtifactData.content.toLowerCase().includes('phase 5'), 'Prompt 1 should discuss Phase 5');
  const prompt1Response = runtime.buildManagedArtifactResponseText(prompt1Result, clarification);
  assert(prompt1Response === 'I created and delivered phase-five-success-proof.md.', `Prompt 1 response should be artifact-aware, got: ${prompt1Response}`);
  assert(!prompt1Response.toLowerCase().includes('please provide the 5 key achievements'), 'Prompt 1 response should suppress clarification text');
  const prompt1Notification = await runtime.getTaskNotificationByArtifactId(prompt1Artifact.artifact_id);
  assert(prompt1Notification, 'Prompt 1 delivery notification missing');
  assert(String(prompt1Notification.notification_kind || '') === 'artifact_delivery', 'Prompt 1 notification kind mismatch');
  assert(String(prompt1Notification.delivery_state || '') === runtime.TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Prompt 1 delivery should complete');
  const prompt1Attempt = await runtime.getNotificationDeliveryAttemptByNotificationId(prompt1Notification.notification_id);
  assert(prompt1Attempt && prompt1Attempt.success === true, 'Prompt 1 delivery attempt should succeed');
  assert(String(prompt1Attempt.handled_by || '') === 'plugin', 'Prompt 1 send should be handled by plugin');
  assert(String(prompt1Attempt.delivered_file_message_id || '') !== '', 'Prompt 1 should persist delivered file message id');

  // Prompt 2: website-style markdown should materialize before terminal recovery.
  const prompt2 = historyPrompt(
    'runtime-delivery-proof.md',
    'Create a markdown file named website-agent-path.md with a 7-step plan for how BlockFork could build, verify, package, and deliver a simple website through an agent workflow.'
  );
  assert(runtime.extractManagedArtifactFilename(prompt2) === 'website-agent-path.md', 'Current-turn filename extraction should prefer website-agent-path.md');
  const prompt2Task = await createArtifactTask('prompt2', prompt2, true);
  const prompt2Bridge = await runtime.attemptManagedArtifactMaterializationBeforeTerminalRecovery(prompt2Task.execution.execution_id, '', {
    requestId: prompt2Task.requestId,
    actorSource: 'runtime',
    autoDeliver: true,
    relayLabel: 'cleanbench',
    promptText: prompt2,
  });
  assert(prompt2Bridge.ok === true, `Prompt 2 recovery bridge should succeed, got ${prompt2Bridge.reason || 'unknown'}`);
  assert(String(prompt2Bridge.successText || '').includes('website-agent-path.md'), 'Prompt 2 bridge should emit an artifact-aware success text');
  assert(prompt2Bridge.materialized && prompt2Bridge.materialized.ok === true, 'Prompt 2 bridge should include a successful materialization result');
  const prompt2Artifact = await runtime.getExecutionArtifactByExecutionId(prompt2Task.execution.execution_id);
  assert(prompt2Artifact, 'Prompt 2 artifact row missing');
  assert(String(prompt2Artifact.artifact_filename || '') === 'website-agent-path.md', `Prompt 2 persisted filename mismatch: ${prompt2Artifact.artifact_filename}`);
  assert(String(prompt2Artifact.verification_state || '') === runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Prompt 2 artifact should be verified');
  assert(String(prompt2Artifact.delivery_confirmed || 0) === '1', 'Prompt 2 artifact should be delivery confirmed');
  const prompt2File = path.join(workspaceRoot, 'artifacts', prompt2Task.execution.execution_id, 'website-agent-path.md');
  assert(fs.existsSync(prompt2File), 'Prompt 2 artifact file should exist');
  const prompt2ArtifactData = readArtifact(prompt2File);
  assert(prompt2ArtifactData.steps === 7, `Prompt 2 should contain exactly 7 numbered steps, got ${prompt2ArtifactData.steps}`);
  assert(prompt2ArtifactData.content.startsWith('# Website Agent Path'), 'Prompt 2 should have a website-specific markdown heading');
  assert(prompt2ArtifactData.content.toLowerCase().includes('website'), 'Prompt 2 should mention website');
  assert(prompt2ArtifactData.content.toLowerCase().includes('build'), 'Prompt 2 should mention build');
  assert(prompt2ArtifactData.content.toLowerCase().includes('verify'), 'Prompt 2 should mention verify');
  assert(prompt2ArtifactData.content.toLowerCase().includes('package'), 'Prompt 2 should mention package');
  assert(prompt2ArtifactData.content.toLowerCase().includes('deliver'), 'Prompt 2 should mention deliver');
  const prompt2Response = runtime.buildManagedArtifactResponseText(prompt2Bridge.materialized, '');
  assert(prompt2Response === 'I created and delivered website-agent-path.md.', `Prompt 2 response should be artifact-aware, got: ${prompt2Response}`);
  assert(!prompt2Response.toLowerCase().includes("couldn't verify"), 'Prompt 2 response should suppress fallback text');
  const prompt2Notification = await runtime.getTaskNotificationByArtifactId(prompt2Artifact.artifact_id);
  assert(prompt2Notification, 'Prompt 2 delivery notification missing');
  assert(String(prompt2Notification.delivery_state || '') === runtime.TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Prompt 2 delivery should complete');
  const prompt2Attempt = await runtime.getNotificationDeliveryAttemptByNotificationId(prompt2Notification.notification_id);
  assert(prompt2Attempt && prompt2Attempt.success === true, 'Prompt 2 delivery attempt should succeed');
  assert(String(prompt2Attempt.handled_by || '') === 'plugin', 'Prompt 2 send should be handled by plugin');
  assert(String(prompt2Attempt.delivered_file_message_id || '') !== '', 'Prompt 2 should persist delivered file message id');

  // Unsupported multi-artifact request should fail honestly.
  const multiPrompt = 'Create a markdown file named agent-runtime-proof.md with a 6-step flow for how BlockFork could evolve from verified artifact delivery into an agentic workflow runtime. Create a markdown file named website-agent-path.md with a 7-step plan for how BlockFork could build, verify, package, and deliver a simple website through an agent workflow.';
  const multiTask = await createArtifactTask('multi', multiPrompt, true);
  const multiResult = await runtime.materializeVerifiedArtifactForExecution(multiTask.execution.execution_id, '', {
    requestId: multiTask.requestId,
    actorSource: 'runtime',
    autoDeliver: false,
    promptText: multiPrompt,
  });
  assert(multiResult.ok === false, 'Multi-artifact request should fail honestly');
  assert(String(multiResult.reason || '') === 'artifact_multiple_requests_unsupported', `Unexpected multi-artifact reason: ${multiResult.reason}`);
  const multiArtifact = await runtime.getExecutionArtifactByExecutionId(multiTask.execution.execution_id);
  assert(!multiArtifact, 'Multi-artifact request should not create an artifact row');

  // Text-only prompt should not create an artifact task.
  const textOnlySession = await createTargetedSession('text-only', true);
  const textOnlyRequestId = makeId('text_only_req');
  const textOnlyTask = (await runtime.createTaskRecord({
    sessionId: textOnlySession.session.session_id,
    requestId: textOnlyRequestId,
    idempotencyKey: makeId('text_only_task'),
    objectiveText: 'Tell me a joke about turtles.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;
  assert(String(textOnlyTask.task_kind || '') !== 'artifact_task', 'Text-only prompt should not classify as an artifact task');
  const textOnlyExecution = (await runtime.createExecutionRecord({
    sessionId: textOnlySession.session.session_id,
    requestId: `${textOnlyRequestId}_exec`,
    idempotencyKey: makeId('text_only_exec'),
    taskId: textOnlyTask.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;
  const textOnlyResult = await runtime.materializeVerifiedArtifactForExecution(textOnlyExecution.execution_id, 'Sure.', {
    requestId: textOnlyRequestId,
    actorSource: 'runtime',
    promptText: 'Tell me a joke about turtles.',
  });
  assert(textOnlyResult.skipped === true || textOnlyResult.ok === true, 'Text-only prompt should not create an artifact');
  const textOnlyArtifact = await runtime.getExecutionArtifactByExecutionId(textOnlyExecution.execution_id);
  assert(!textOnlyArtifact, 'Text-only prompt should not create an artifact row');

  console.log('artifact response reconciliation and recovery ordering verifier passed');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
