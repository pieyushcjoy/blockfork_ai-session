#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-agent-run-XXXXXX)"
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
const message = readFlag('--message');
const media = readFlag('--media');
const threadId = readFlag('--thread-id');
const forceDocument = args.includes('--force-document');

if (mode === 'failure') {
  console.error('simulated openclaw delivery failure');
  process.exit(17);
}

process.stdout.write(`${JSON.stringify({
  action: 'send',
  channel: 'telegram',
  dryRun: mode === 'dry-run',
  handledBy: mode === 'dry-run' ? 'core' : 'plugin',
  payload: {
    ok: true,
    chatId: target,
    messageId: mode === 'dry-run' ? undefined : `msg_${Math.floor(Math.random() * 100000)}`,
    fileMessageId: mode === 'dry-run' ? undefined : `file_${Math.floor(Math.random() * 100000)}`,
    message,
    mediaUrl: media || null,
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

function countMatches(text, pattern) {
  return String(text || '').match(pattern)?.length || 0;
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
    notes: 'agent runtime verifier relay',
  }, { timestamp: new Date().toISOString() });

  const doctor = await runtime.runOpenClawRelayDoctor('cleanbench', { probe: true, timeoutMs: 5000 });
  assert(doctor.readiness === 'ready', `Expected cleanbench relay ready, got ${doctor.readiness}`);

  async function createTargetedSession(label, withDeliveryTarget = true) {
    const sessionBase = await runtime.createSessionRecord({
      user_id: `agent_runtime_${label}_${Date.now()}`,
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

  async function createTaskAndExecution(objectiveText, withDeliveryTarget = true) {
    const sessionPack = await createTargetedSession('agentic', withDeliveryTarget);
    const requestId = makeId('agent_req');
    const task = (await runtime.createTaskRecord({
      sessionId: sessionPack.session.session_id,
      requestId,
      idempotencyKey: makeId('agent_task'),
      objectiveText,
      actorSource: 'test',
      reasonCode: 'task_received',
    })).task;
    const execution = (await runtime.createExecutionRecord({
      sessionId: sessionPack.session.session_id,
      requestId: `${requestId}_exec`,
      idempotencyKey: makeId('agent_exec'),
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

  async function getRows(sql, params = []) {
    const statement = db.prepare(sql);
    statement.bind(params);
    const rows = [];
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
    statement.free();
    return rows;
  }

  const agentPrompt = 'Create a markdown execution brief named agent-workflow-proof.md using a planner, writer, verifier, and delivery step to explain how BlockFork coordinates sub-agents.';
  const created = await createTaskAndExecution(agentPrompt, true);
  assert(String(created.task.task_kind || '') === 'agent_workflow_task', `Expected created task kind agent_workflow_task, got ${created.task.task_kind}`);
  const result = await runtime.attemptManagedArtifactMaterializationBeforeTerminalRecovery(created.execution.execution_id, 'I have the request and will create the artifact.', {
    requestId: created.requestId,
    actorSource: 'runtime',
    relayLabel: 'cleanbench',
    autoDeliver: true,
    promptText: agentPrompt,
  });

  assert(result.ok === true, `Agent workflow materialization should succeed, got ${result.reason || 'unknown'}`);
  assert(result.materialized && result.materialized.ok === true, 'Agent workflow should return a materialized artifact payload');
  const reconciledText = runtime.buildManagedArtifactResponseText(result.materialized, 'Please provide more details.');
  assert(String(reconciledText || '').toLowerCase().includes('agent-workflow-proof.md'), 'Response reconciliation should mention the agent workflow artifact filename');
  assert(/created/i.test(reconciledText), 'Response reconciliation should produce artifact-aware confirmation text');

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

  const runRows = await getRows('SELECT * FROM agent_runs WHERE execution_id = ? ORDER BY created_at ASC', [created.execution.execution_id]);
  assert(runRows.length === 1, `Expected one agent run, got ${runRows.length}`);
  const agentRun = runRows[0];
  assert(String(agentRun.task_id || '') === String(created.task.task_id || ''), 'Agent run task binding mismatch');
  assert(String(agentRun.status || '') === 'completed', `Expected completed agent run, got ${agentRun.status}`);
  assert(Number(agentRun.current_step_index || 0) >= 5, 'Agent run should advance through all sequential steps');

  const stepRows = await getRows('SELECT * FROM agent_steps WHERE agent_run_id = ? ORDER BY step_index ASC, created_at ASC', [agentRun.agent_run_id]);
  assert(stepRows.length === 5, `Expected five sequential agent steps, got ${stepRows.length}`);
  const roles = stepRows.map((row) => String(row.role || ''));
  assert(JSON.stringify(roles) === JSON.stringify(['planner', 'context', 'writer', 'verifier', 'delivery']), `Unexpected agent step roles: ${roles.join(', ')}`);
  assert(stepRows.every((row, index) => Number(row.step_index || 0) === index + 1), 'Agent steps should be ordered sequentially');
  assert(String(stepRows[0].status || '') === 'completed', 'Planner step should complete');
  assert(String(stepRows[1].status || '') === 'completed', 'Context step should complete');
  assert(String(stepRows[2].status || '') === 'completed', 'Writer step should complete');
  assert(String(stepRows[3].status || '') === 'completed', 'Verifier step should complete');
  assert(['completed', 'skipped', 'retryable'].includes(String(stepRows[4].status || '')), 'Delivery step should have a delivery outcome');

  const events = await getRows('SELECT * FROM agent_step_events WHERE agent_run_id = ? ORDER BY created_at ASC', [agentRun.agent_run_id]);
  assert(events.length >= 5, 'Agent run should persist step events');

  const artifact = await runtime.getExecutionArtifactByExecutionId(created.execution.execution_id);
  assert(artifact, 'Agent artifact row should exist');
  assert(String(artifact.artifact_filename || '') === 'agent-workflow-proof.md', `Expected agent-workflow-proof.md, got ${artifact.artifact_filename}`);
  assert(String(artifact.verification_state || '') === runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Agent artifact should be verified');
  assert(String(artifact.delivery_confirmed || 0) === '1', 'Agent artifact should be delivery confirmed');
  const artifactPath = path.join(workspaceRoot, 'artifacts', created.execution.execution_id, 'agent-workflow-proof.md');
  assert(fs.existsSync(artifactPath), 'Agent artifact file should exist on disk');
  const artifactContent = fs.readFileSync(artifactPath, 'utf8');
  assert(/^#\s+Agent Workflow Proof/m.test(artifactContent), 'Agent artifact should include a heading');
  assert(countMatches(artifactContent, /^\s*-\s+/gm) === 5, 'Agent workflow brief should contain five bullets');
  assert(artifactContent.toLowerCase().includes('planner agent'), 'Agent workflow brief should mention the planner agent');
  assert(artifactContent.toLowerCase().includes('context agent'), 'Agent workflow brief should mention the context agent');
  assert(artifactContent.toLowerCase().includes('writer agent'), 'Agent workflow brief should mention the writer agent');
  assert(artifactContent.toLowerCase().includes('verifier agent'), 'Agent workflow brief should mention the verifier agent');
  assert(artifactContent.toLowerCase().includes('delivery agent'), 'Agent workflow brief should mention the delivery agent');
  assert(crypto.createHash('sha256').update(artifactContent, 'utf8').digest('hex') === artifact.content_hash, 'Persisted hash should match the agent artifact content');

  const notification = await runtime.getTaskNotificationByArtifactId(artifact.artifact_id);
  assert(notification, 'Agent artifact should have a delivery notification');
  assert(String(notification.notification_kind || '') === 'artifact_delivery', 'Agent notification should be an artifact delivery');
  assert(String(notification.delivery_state || '') === runtime.TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Agent delivery should be delivered');
  const attempt = await runtime.getNotificationDeliveryAttemptByNotificationId(notification.notification_id);
  assert(attempt && attempt.success === true, 'Agent delivery attempt should exist and succeed');
  assert(String(attempt.dry_run || 0) === '0', 'Agent delivery should be a real send');
  assert(String(attempt.handled_by || '') === 'plugin', 'Agent delivery should be handled by plugin');
  assert(String(attempt.delivered_file_message_id || attempt.delivered_message_id || '') !== '', 'Agent delivery should persist a message id');

  const simpleStart = await getRows('SELECT COUNT(*) AS count FROM agent_runs', []);
  const simpleSession = await createTargetedSession('simple', true);
  const simpleTask = (await runtime.createTaskRecord({
    sessionId: simpleSession.session.session_id,
    requestId: makeId('simple_req'),
    idempotencyKey: makeId('simple_task'),
    objectiveText: 'Hi there',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;
  const simpleExecution = (await runtime.createExecutionRecord({
    sessionId: simpleSession.session.session_id,
    requestId: `${simpleTask.request_id}_exec`,
    idempotencyKey: makeId('simple_exec'),
    taskId: simpleTask.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;
  await runtime.transitionExecution(simpleExecution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    requestId: simpleExecution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await runtime.transitionExecution(simpleExecution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    requestId: simpleExecution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_running',
  });
  const simpleResult = await runtime.attemptManagedArtifactMaterializationBeforeTerminalRecovery(simpleExecution.execution_id, 'Hello!', {
    requestId: simpleTask.request_id,
    actorSource: 'runtime',
    relayLabel: 'cleanbench',
    autoDeliver: true,
    promptText: 'Hi there',
  });
  assert(simpleResult.required === false && simpleResult.ok === true && simpleResult.skipped === true, 'Simple chat should bypass the agent runtime');
  const simpleRuns = await getRows('SELECT * FROM agent_runs WHERE execution_id = ? OR task_id = ? ORDER BY created_at ASC', [simpleExecution.execution_id, simpleTask.task_id]);
  assert(simpleRuns.length === 0, 'Simple chat should not create an agent run');

  console.log(JSON.stringify({
    ok: true,
    agent_run_id: agentRun.agent_run_id,
    artifact: artifact.artifact_filename,
    messageId: String(attempt.delivered_file_message_id || attempt.delivered_message_id || ''),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
