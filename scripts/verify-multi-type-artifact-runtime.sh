#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-multi-type-artifact-XXXXXX)"
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

function historyPrompt(previousText, currentText) {
  return [
    `#1 Wed 2026-05-27 10:00 GMT+5:30 previous: ${previousText}`,
    `#2 Wed 2026-05-27 10:05 GMT+5:30 current: ${currentText}`,
  ].join('\n');
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
    notes: 'multi-type artifact runtime verifier relay',
  }, { timestamp: new Date().toISOString() });

  const doctor = await runtime.runOpenClawRelayDoctor('cleanbench', { probe: true, timeoutMs: 5000 });
  assert(doctor.readiness === 'ready', `Expected cleanbench relay ready, got ${doctor.readiness}`);

  async function createTargetedSession(label, withDeliveryTarget = true) {
    const sessionBase = await runtime.createSessionRecord({
      user_id: `multi_type_${label}_${Date.now()}`,
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
    const sessionPack = await createTargetedSession('artifact', withDeliveryTarget);
    const requestId = makeId('artifact_req');
    const task = (await runtime.createTaskRecord({
      sessionId: sessionPack.session.session_id,
      requestId,
      idempotencyKey: makeId('artifact_task'),
      objectiveText,
      actorSource: 'test',
      reasonCode: 'task_received',
    })).task;
    const execution = (await runtime.createExecutionRecord({
      sessionId: sessionPack.session.session_id,
      requestId: `${requestId}_exec`,
      idempotencyKey: makeId('artifact_exec'),
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

  function readArtifact(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      content,
      hash: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(content, 'utf8'),
      lines: content.split(/\r?\n/).filter((line) => line.trim().length > 0),
      bullets: countMatches(content, /^\s*-\s+/gm),
      numbered: countMatches(content, /^\s*\d+\.\s+/gm),
    };
  }

  async function materializeAndComplete(label, promptText, expectedFilename, expectedType, checks = {}) {
    const taskPack = await createTaskAndExecution(promptText, true);
    assert(String(taskPack.task.task_kind || '') !== '', 'Task classification should exist');
    const result = await runtime.attemptManagedArtifactMaterializationBeforeTerminalRecovery(taskPack.execution.execution_id, 'I have the request and will create the artifact.', {
      requestId: taskPack.requestId,
      actorSource: 'runtime',
      autoDeliver: true,
      relayLabel: 'cleanbench',
      promptText,
    });
    assert(result.ok === true, `${label} materialization failed: ${result.reason || 'unknown'}`);
    const materializedFilename = String(result.filename || result.materialized?.filename || result.materialized?.artifact?.artifact_filename || '');
    assert(materializedFilename === expectedFilename, `${label} filename mismatch: ${materializedFilename}`);

    await runtime.transitionExecution(taskPack.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
      requestId: taskPack.requestId,
      actorSource: 'runtime',
      reasonCode: 'execution_completed',
    });
    await runtime.transitionTask(taskPack.task.task_id, runtime.TASK_STATES.COMPLETED, {
      executionId: taskPack.execution.execution_id,
      requestId: taskPack.requestId,
      actorSource: 'runtime',
      reasonCode: 'task_completed',
    });

    const artifact = await runtime.getExecutionArtifactByExecutionId(taskPack.execution.execution_id);
    assert(artifact, `${label} artifact row missing`);
    assert(String(artifact.artifact_filename || '') === expectedFilename, `${label} persisted filename mismatch: ${artifact.artifact_filename}`);
    assert(String(artifact.artifact_type || '') === expectedType, `${label} artifact type mismatch: ${artifact.artifact_type}`);
    assert(String(artifact.verification_state || '') === runtime.ARTIFACT_VERIFICATION_STATES.VERIFIED, `${label} artifact should be verified`);
    assert(String(artifact.delivery_confirmed || 0) === '1', `${label} artifact should be delivery confirmed`);

    const filePath = path.join(workspaceRoot, 'artifacts', taskPack.execution.execution_id, expectedFilename);
    assert(fs.existsSync(filePath), `${label} artifact file should exist`);
    const artifactData = readArtifact(filePath);

    if (checks.file) {
      checks.file(artifactData, artifact, filePath);
    }

    const assessment = await runtime.getTaskArtifactAssessmentByTaskId(taskPack.task.task_id);
    assert(assessment, `${label} assessment missing`);
    assert(String(assessment.structure_state || '') === runtime.TASK_ARTIFACT_STRUCTURE_STATES.VALID, `${label} structure state mismatch: ${assessment.structure_state}`);
    assert(String(assessment.alignment_state || '') === runtime.TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED, `${label} alignment state mismatch: ${assessment.alignment_state}`);
    assert(Number(assessment.confidence_score || 0) >= 80, `${label} confidence score too low: ${assessment.confidence_score}`);
    assert(String(assessment.confidence_band || '') === runtime.TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH, `${label} confidence band mismatch: ${assessment.confidence_band}`);

    const notification = await runtime.getTaskNotificationByArtifactId(artifact.artifact_id);
    assert(notification, `${label} delivery notification missing`);
    assert(String(notification.notification_kind || '') === 'artifact_delivery', `${label} notification kind mismatch: ${notification.notification_kind}`);
    assert(String(notification.delivery_state || '') === runtime.TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, `${label} delivery state mismatch: ${notification.delivery_state}`);

    const attempt = await runtime.getNotificationDeliveryAttemptByNotificationId(notification.notification_id);
    assert(attempt && attempt.success === true, `${label} delivery attempt missing or unsuccessful`);
    assert(String(attempt.dry_run || 0) === '0', `${label} delivery should be a real send`);
    assert(String(attempt.handled_by || '') === 'plugin', `${label} delivery should be handled by plugin`);
    assert(String(attempt.delivered_file_message_id || attempt.delivered_message_id || '') !== '', `${label} message id should be persisted`);

    const responseText = runtime.buildManagedArtifactResponseText(result.materialized || result, 'Please provide more details.');
    assert(!/please provide more details/i.test(responseText), `${label} response should suppress clarification text`);
    assert(responseText.toLowerCase().includes(expectedFilename.toLowerCase()), `${label} response should mention filename`);

    return { taskPack, result, artifact, assessment, notification, attempt, filePath, artifactData };
  }

  // Markdown should still work with current-turn binding.
  const markdownPrompt = historyPrompt(
    'runtime-delivery-proof.md',
    'Create a markdown file named phase-six-md-proof.md with a short 5-bullet summary of how BlockFork coordinates agent steps.'
  );
  const markdownRun = await materializeAndComplete('markdown', markdownPrompt, 'phase-six-md-proof.md', 'markdown', {
    file: (artifactData) => {
      assert(artifactData.bullets === 5, `Markdown artifact should contain 5 bullets, got ${artifactData.bullets}`);
      assert(/^#\s+/m.test(artifactData.content), 'Markdown artifact should include a heading');
    },
  });
  assert(markdownRun.artifactData.content.toLowerCase().includes('blockfork'), 'Markdown artifact should discuss BlockFork');

  // Plain text should generate a real .txt artifact with five notes.
  const textPrompt = historyPrompt(
    'phase-six-md-proof.md',
    'Create a text file named agent-runtime-notes.txt with 5 short notes about how BlockFork coordinates planner, context, writer, verifier, and delivery steps.'
  );
  const textRun = await materializeAndComplete('text', textPrompt, 'agent-runtime-notes.txt', 'text', {
    file: (artifactData) => {
      assert(artifactData.lines.length === 5, `Text artifact should contain 5 non-empty lines, got ${artifactData.lines.length}`);
      assert(!/^#\s+/m.test(artifactData.content), 'Text artifact should not be markdown');
      assert(artifactData.content.toLowerCase().includes('planner'), 'Text artifact should mention planner');
      assert(artifactData.content.toLowerCase().includes('delivery'), 'Text artifact should mention delivery');
    },
  });

  // JSON should be parseable and include the requested schema fields.
  const jsonPrompt = historyPrompt(
    'agent-runtime-notes.txt',
    'Create a JSON file named agent-step-schema.json defining fields for agent_run_id, step_index, role, status, input, output, evidence, artifact_id, and delivery_attempt_id.'
  );
  const jsonRun = await materializeAndComplete('json', jsonPrompt, 'agent-step-schema.json', 'json', {
    file: (artifactData) => {
      assert(!/```/m.test(artifactData.content), 'JSON artifact should not contain code fences');
      const parsed = JSON.parse(artifactData.content);
      assert(Array.isArray(parsed.fields), 'JSON artifact should expose a fields array');
      const fieldNames = parsed.fields.map((field) => String(field.name || ''));
      for (const name of ['agent_run_id', 'step_index', 'role', 'status', 'input', 'output', 'evidence', 'artifact_id', 'delivery_attempt_id']) {
        assert(fieldNames.includes(name), `JSON artifact missing requested field: ${name}`);
      }
      assert(Array.isArray(parsed.ordered_steps) && parsed.ordered_steps.length === 5, 'JSON artifact should include five ordered steps');
      assert(parsed.workflow && parsed.workflow.sequential === true, 'JSON artifact should describe a sequential workflow');
    },
  });

  // HTML should be a complete document with hero, cards, and CTA.
  const htmlPrompt = historyPrompt(
    'agent-step-schema.json',
    'Create an HTML file named blockfork-agent-runtime.html with a simple landing page explaining BlockFork’s verified agent workflow. Include a title, hero section, three feature cards, and a CTA.'
  );
  const htmlRun = await materializeAndComplete('html', htmlPrompt, 'blockfork-agent-runtime.html', 'html', {
    file: (artifactData) => {
      assert(/<!doctype html>/i.test(artifactData.content) || /<html[\s>]/i.test(artifactData.content), 'HTML artifact should include a doctype or html tag');
      assert(/<head[\s>]/i.test(artifactData.content), 'HTML artifact should include a head tag');
      assert(/<title>.*<\/title>/i.test(artifactData.content), 'HTML artifact should include a title tag');
      assert(/<body[\s>]/i.test(artifactData.content), 'HTML artifact should include a body tag');
      assert((artifactData.content.match(/<article class="card">/g) || []).length === 3, 'HTML artifact should include three feature cards');
      assert(/class="hero"/i.test(artifactData.content), 'HTML artifact should include a hero section');
      assert(/class="cta"/i.test(artifactData.content), 'HTML artifact should include a CTA section');
    },
  });

  // Agent workflow should be able to produce a non-markdown artifact too.
  const agentWorkflowPrompt = historyPrompt(
    'blockfork-agent-runtime.html',
    'Use a planner, context, writer, verifier, and delivery step to create a JSON file named agent-workflow-schema.json describing an agent run with ordered steps.'
  );
  const agentTaskPack = await createTaskAndExecution(agentWorkflowPrompt, true);
  assert(String(agentTaskPack.task.task_kind || '') === 'agent_workflow_task', `Expected agent workflow task kind, got ${agentTaskPack.task.task_kind}`);
  const agentWorkflowResult = await runtime.attemptManagedArtifactMaterializationBeforeTerminalRecovery(agentTaskPack.execution.execution_id, 'I have the request and will create the artifact.', {
    requestId: agentTaskPack.requestId,
    actorSource: 'runtime',
    autoDeliver: true,
    relayLabel: 'cleanbench',
    promptText: agentWorkflowPrompt,
  });
  assert(agentWorkflowResult.ok === true, `Agent workflow JSON materialization failed: ${agentWorkflowResult.reason || 'unknown'}`);
  const agentWorkflowFilename = String(agentWorkflowResult.filename || agentWorkflowResult.materialized?.filename || agentWorkflowResult.materialized?.artifact?.artifact_filename || '');
  assert(agentWorkflowFilename === 'agent-workflow-schema.json', `Agent workflow filename mismatch: ${agentWorkflowFilename}`);
  await runtime.transitionExecution(agentTaskPack.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    requestId: agentTaskPack.requestId,
    actorSource: 'runtime',
    reasonCode: 'execution_completed',
  });
  await runtime.transitionTask(agentTaskPack.task.task_id, runtime.TASK_STATES.COMPLETED, {
    executionId: agentTaskPack.execution.execution_id,
    requestId: agentTaskPack.requestId,
    actorSource: 'runtime',
    reasonCode: 'task_completed',
  });
  const agentRunRows = await getRows('SELECT * FROM agent_runs WHERE execution_id = ? ORDER BY created_at ASC', [agentTaskPack.execution.execution_id]);
  assert(agentRunRows.length === 1, 'Agent workflow JSON prompt should create an agent run');
  const agentSteps = await getRows('SELECT * FROM agent_steps WHERE agent_run_id = ? ORDER BY step_index ASC, created_at ASC', [agentRunRows[0].agent_run_id]);
  assert(agentSteps.length === 5, 'Agent workflow JSON prompt should create five agent steps');
  assert(agentSteps[4] && String(agentSteps[4].role || '') === 'delivery', 'Agent workflow delivery step missing');
  const agentWorkflowArtifact = await runtime.getExecutionArtifactByExecutionId(agentTaskPack.execution.execution_id);
  assert(agentWorkflowArtifact, 'Agent workflow JSON artifact row missing');
  assert(String(agentWorkflowArtifact.artifact_filename || '') === 'agent-workflow-schema.json', 'Agent workflow JSON filename mismatch');
  assert(String(agentWorkflowArtifact.artifact_type || '') === 'json', 'Agent workflow JSON type mismatch');
  const agentWorkflowFile = path.join(workspaceRoot, 'artifacts', agentTaskPack.execution.execution_id, 'agent-workflow-schema.json');
  assert(fs.existsSync(agentWorkflowFile), 'Agent workflow JSON file missing');
  const agentWorkflowData = readArtifact(agentWorkflowFile);
  const agentWorkflowParsed = JSON.parse(agentWorkflowData.content);
  assert(Array.isArray(agentWorkflowParsed.ordered_steps) && agentWorkflowParsed.ordered_steps.length === 5, 'Agent workflow JSON should include ordered steps');
  assert(agentWorkflowParsed.workflow && agentWorkflowParsed.workflow.step_roles.includes('planner'), 'Agent workflow JSON should mention planner');
  const agentWorkflowNotification = await runtime.getTaskNotificationByArtifactId(agentWorkflowArtifact.artifact_id);
  assert(agentWorkflowNotification && String(agentWorkflowNotification.delivery_state || '') === runtime.TASK_NOTIFICATION_DELIVERY_STATES.DELIVERED, 'Agent workflow JSON should be delivered');

  // Unsupported types should be rejected honestly.
  const unsupportedPrompt = historyPrompt(
    'agent-workflow-schema.json',
    'Create a pdf file named architecture-proof.pdf describing the verified agent workflow.'
  );
  const unsupportedTaskPack = await createTaskAndExecution(unsupportedPrompt, true);
  const unsupportedResult = await runtime.attemptManagedArtifactMaterializationBeforeTerminalRecovery(unsupportedTaskPack.execution.execution_id, '', {
    requestId: unsupportedTaskPack.requestId,
    actorSource: 'runtime',
    autoDeliver: true,
    relayLabel: 'cleanbench',
    promptText: unsupportedPrompt,
  });
  assert(unsupportedResult.ok === false, 'Unsupported type should fail');
  assert(String(unsupportedResult.reason || '') === 'artifact_type_unsupported', `Unsupported type reason mismatch: ${unsupportedResult.reason}`);
  const unsupportedArtifacts = await getRows('SELECT * FROM execution_artifacts WHERE execution_id = ? ORDER BY created_at ASC', [unsupportedTaskPack.execution.execution_id]);
  assert(unsupportedArtifacts.length === 0, 'Unsupported type should not create artifact rows');

  // Multi-file prompts should still be rejected honestly.
  const multiPrompt = historyPrompt(
    'architecture-proof.pdf',
    'Create a markdown file named one.md and a JSON file named two.json describing the workflow.'
  );
  const multiTaskPack = await createTaskAndExecution(multiPrompt, true);
  const multiResult = await runtime.attemptManagedArtifactMaterializationBeforeTerminalRecovery(multiTaskPack.execution.execution_id, '', {
    requestId: multiTaskPack.requestId,
    actorSource: 'runtime',
    autoDeliver: true,
    relayLabel: 'cleanbench',
    promptText: multiPrompt,
  });
  assert(multiResult.ok === false, 'Multi-file prompt should fail honestly');
  assert(String(multiResult.reason || '') === 'artifact_multiple_requests_unsupported', `Multi-file reason mismatch: ${multiResult.reason}`);
  const multiArtifacts = await getRows('SELECT * FROM execution_artifacts WHERE execution_id = ? ORDER BY created_at ASC', [multiTaskPack.execution.execution_id]);
  assert(multiArtifacts.length === 0, 'Multi-file prompt should not create an artifact');

  // Simple chat should remain outside the artifact runtime.
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
  assert(simpleResult.required === false && simpleResult.ok === true && simpleResult.skipped === true, 'Simple chat should bypass the artifact runtime');
  const simpleRuns = await getRows('SELECT * FROM agent_runs WHERE execution_id = ? OR task_id = ? ORDER BY created_at ASC', [simpleExecution.execution_id, simpleTask.task_id]);
  assert(simpleRuns.length === 0, 'Simple chat should not create an agent run');

  console.log(JSON.stringify({
    ok: true,
    markdown: markdownRun.artifact.artifact_filename,
    text: textRun.artifact.artifact_filename,
    json: jsonRun.artifact.artifact_filename,
    html: htmlRun.artifact.artifact_filename,
    agentWorkflowJson: agentWorkflowArtifact.artifact_filename,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
