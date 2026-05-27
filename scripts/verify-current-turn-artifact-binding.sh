#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-current-turn-artifact-XXXXXX)"
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
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const mode = process.env.FAKE_OPENCLAW_MODE || (args.includes('--dry-run') ? 'dry-run' : 'real');

function readFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '') : '';
}

const target = readFlag('--target');
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

function makeHistoryPrompt(previousFilename, currentPrompt, marker = '460') {
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
    notes: 'current turn artifact binding verifier relay',
  }, { timestamp: new Date().toISOString() });

  const doctor = await runtime.runOpenClawRelayDoctor('cleanbench', { probe: true, timeoutMs: 5000 });
  assert(doctor.readiness === 'ready', `Expected cleanbench relay to be ready, got ${doctor.readiness}`);

  const currentOnly = 'Create a markdown file named delivery-truth-proof.md with exactly 5 bullet points explaining the difference between artifact creation, artifact verification, and artifact delivery.';
  const historyPrompt = makeHistoryPrompt('runtime-delivery-proof.md', currentOnly);
  const summarized = runtime.summarizeTaskObjectiveFromBody({
    messages: [
      { role: 'user', content: 'old context should not win' },
      { role: 'assistant', content: 'ack' },
      { role: 'user', content: historyPrompt },
    ],
  });
  assert(summarized.includes('delivery-truth-proof.md'), 'Current-turn summarizer should keep the active filename');
  assert(!summarized.includes('runtime-delivery-proof.md'), 'Current-turn summarizer should drop the stale filename');

  async function createTargetedSession(label, withDeliveryTarget = true) {
    const sessionBase = await runtime.createSessionRecord({
      user_id: `artifact_binding_${label}_${Date.now()}`,
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
    const db = await runtime.ensureBillingDb();
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

  async function inspectArtifactExecution(label, objectiveText, expectedFilename, expectedKeywords = []) {
    const created = await createArtifactTask(label, objectiveText, true);
    const result = await runtime.materializeVerifiedArtifactForExecution(created.execution.execution_id, 'I have the request and will create the artifact.', {
      requestId: created.requestId,
      actorSource: 'runtime',
      relayLabel: 'cleanbench',
      autoDeliver: true,
    });
    assert(result.ok === true, `Materialization for ${label} should succeed, got ${result.reason || 'unknown'}`);

    await runtime.transitionExecution(created.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
      requestId: created.requestId,
      actorSource: 'runtime',
      reasonCode: 'execution_completed',
    });
    await runtime.transitionTask(created.task.task_id, runtime.TASK_STATES.COMPLETED, {
      executionId: created.execution.execution_id,
      requestId: created.requestId,
      actorSource: 'runtime',
      reasonCode: 'task_completed',
    });

    const artifact = await runtime.getExecutionArtifactByExecutionId(created.execution.execution_id);
    const notification = await runtime.getTaskNotificationByArtifactId(artifact.artifact_id);
    const attempt = notification ? await runtime.getNotificationDeliveryAttemptByNotificationId(notification.notification_id) : null;
    assert(artifact, `Artifact row should exist for ${label}`);
    assert(String(artifact.artifact_filename || '') === expectedFilename, `Expected ${expectedFilename}, got ${artifact.artifact_filename}`);
    assert(String(artifact.verification_state || '') === runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Artifact should be verified');
    assert(String(artifact.delivery_confirmed || 0) === '1', 'Artifact should be delivery confirmed');
    assert(notification, 'Artifact delivery notification should exist');
    assert(String(notification.notification_kind || '') === 'artifact_delivery', 'Notification kind should be artifact_delivery');
    assert(String(notification.delivery_state || '') === runtime.TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Delivery should complete automatically');
    assert(attempt && attempt.success === true, 'Delivery attempt should exist and succeed');
    assert(attempt.handled_by === 'plugin', 'OpenClaw should handle the real send');
    assert(String(attempt.dry_run || 0) === '0', 'Real send should not be a dry-run');
    assert(String(attempt.delivered_file_message_id || attempt.delivered_message_id || '') !== '', 'Delivered file message id should be stored');
    const filePath = path.join(workspaceRoot, 'artifacts', created.execution.execution_id, expectedFilename);
    assert(fs.existsSync(filePath), `Artifact file should exist on disk: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => /^-\s+/.test(line));
    assert(lines.length > 0, 'Artifact file should contain bullet points');
    const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    assert(hash === artifact.content_hash, 'Persisted hash should match the file content');
    for (const keyword of expectedKeywords) {
      assert(content.toLowerCase().includes(keyword.toLowerCase()), `Artifact content should mention ${keyword}`);
    }

    return {
      created,
      artifact,
      notification,
      attempt,
      content,
      hash,
    };
  }

  const firstPrompt = makeHistoryPrompt(
    'runtime-delivery-proof.md',
    'Create a markdown file named phase-five-success-proof.md with a short 5-bullet summary of what BlockFork has successfully achieved in Phase 5.'
  );
  const first = await inspectArtifactExecution(
    'phase_five_success',
    firstPrompt,
    'phase-five-success-proof.md',
    ['Phase 5', 'artifact prompts', 'relay', 'verification']
  );
  assert(String(first.content.split('\n').filter((line) => /^-\s+/.test(line)).length || 0) === '5', 'First artifact should have 5 bullets');
  assert(String(first.artifact.artifact_filename || '') !== 'runtime-delivery-proof.md', 'First artifact must not reuse the stale filename');

  const secondPrompt = makeHistoryPrompt(
    'phase-five-success-proof.md',
    'Create a markdown file named delivery-truth-proof.md with exactly 5 bullet points explaining the difference between artifact creation, artifact verification, and artifact delivery.',
    '461'
  );
  const second = await inspectArtifactExecution(
    'delivery_truth',
    secondPrompt,
    'delivery-truth-proof.md',
    ['artifact creation', 'artifact verification', 'artifact delivery']
  );
  assert(String(second.content.split('\n').filter((line) => /^-\s+/.test(line)).length || 0) === '5', 'Second artifact should have 5 bullets');
  assert(first.hash !== second.hash, 'Different prompts should produce different content hashes');

  const multiPrompt = makeHistoryPrompt(
    'delivery-truth-proof.md',
    'Create a markdown file named agent-runtime-proof.md with a 6-step flow showing how BlockFork can evolve from verified artifact delivery into an agentic workflow runtime. Create a markdown file named website-agent-path.md with a 7-step plan for how BlockFork could build, verify, package, and deliver a simple website through an agent workflow.',
    '462'
  );
  const multi = await createArtifactTask('multi_artifact', multiPrompt, true);
  const multiResult = await runtime.materializeVerifiedArtifactForExecution(multi.execution.execution_id, 'I have the request and will create the artifact.', {
    requestId: multi.requestId,
    actorSource: 'runtime',
    relayLabel: 'cleanbench',
    autoDeliver: true,
  });
  assert(multiResult.ok === false, 'Multi-artifact prompt should not be silently collapsed');
  assert(multiResult.reason === 'artifact_multiple_requests_unsupported', `Expected multi-artifact rejection, got ${multiResult.reason || 'unknown'}`);
  const multiArtifact = await runtime.getExecutionArtifactByExecutionId(multi.execution.execution_id);
  assert(!multiArtifact, 'Multi-artifact prompt should not create a stale single artifact');

  const textOnly = await createArtifactTask('text_only', 'Hi there', true);
  const textOnlyResult = await runtime.materializeVerifiedArtifactForExecution(textOnly.execution.execution_id, 'Hello!', {
    requestId: textOnly.requestId,
    actorSource: 'runtime',
    relayLabel: 'cleanbench',
    autoDeliver: true,
  });
  assert(textOnlyResult.required === false && textOnlyResult.ok === true && textOnlyResult.skipped === true, 'Text-only prompt should not materialize an artifact');
  const textOnlyArtifact = await runtime.getExecutionArtifactByExecutionId(textOnly.execution.execution_id);
  assert(!textOnlyArtifact, 'Text-only prompt should not create an artifact row');

  console.log(JSON.stringify({
    ok: true,
    first: {
      filename: first.artifact.artifact_filename,
      delivery_state: first.notification.delivery_state,
      message_id: first.attempt.delivered_file_message_id || first.attempt.delivered_message_id || null,
    },
    second: {
      filename: second.artifact.artifact_filename,
      delivery_state: second.notification.delivery_state,
      message_id: second.attempt.delivered_file_message_id || second.attempt.delivered_message_id || null,
    },
    multi_rejected: multiResult.reason,
  }));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
NODE
