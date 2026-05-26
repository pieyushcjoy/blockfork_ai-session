#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-artifact-materialization-before-terminal-recovery-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp

mkdir -p "$TMP_DIR/workspace" "$TMP_DIR/public"
cp "$REPO_ROOT/server.js" "$TMP_DIR/server.js"
cp "$REPO_ROOT/package.json" "$TMP_DIR/package.json"
ln -s "$REPO_ROOT/node_modules" "$TMP_DIR/node_modules"

node - "$TMP_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID()}`;
}

function countBullets(text) {
  return String(text || '').match(/^\s*[-*]\s+/gm)?.length || 0;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

async function main() {
  const tmpDir = process.argv[2];
  const repoRoot = tmpDir;
  const workspaceRoot = path.join(tmpDir, 'workspace');
  process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = workspaceRoot;

  const runtime = require(path.join(repoRoot, 'server.js'));
  const {
    TASK_STATES,
    EXECUTION_STATES,
    TASK_ARTIFACT_CONFIDENCE_BANDS,
    TASK_ARTIFACT_STRUCTURE_STATES,
    TASK_ARTIFACT_ALIGNMENT_STATES,
    createTaskRecord,
    createExecutionRecord,
    transitionTask,
    transitionExecution,
    attemptManagedArtifactMaterializationBeforeTerminalRecovery,
    getExecutionArtifactByExecutionId,
    getTaskArtifactAssessmentByTaskId,
    getTaskCompletionSummaryByTaskId,
    getTaskById,
  } = runtime;

  async function createRunningTask(objectiveText, label) {
    const sessionId = uniqueId(`session_${label}`);
    const requestId = uniqueId(`request_${label}`);
    const taskResult = await createTaskRecord({
      sessionId,
      requestId,
      idempotencyKey: uniqueId(`idem_${label}`),
      objectiveText,
      actorSource: 'test',
      reasonCode: 'task_received',
    });
    const task = taskResult.task;
    assert(task, `Missing task for ${label}`);

    const executionResult = await createExecutionRecord({
      sessionId,
      requestId: `${requestId}_exec`,
      idempotencyKey: uniqueId(`exec_${label}`),
      taskId: task.task_id,
      actorSource: 'test',
      reasonCode: 'request_admitted',
    });
    const execution = executionResult.execution;
    assert(execution, `Missing execution for ${label}`);

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

  async function runBridgeHappyPath() {
    const prompt = 'Create a markdown file named execution-lessons.md with a short 6-bullet summary of what makes technical execution reliable in long-running infrastructure projects.';
    const { task, execution } = await createRunningTask(prompt, 'bridge_happy');
    assert(task.task_kind === 'artifact_task', `Expected artifact_task, got ${task.task_kind}`);
    assert(task.notification_policy === 'progress_and_completion', `Expected progress_and_completion, got ${task.notification_policy}`);
    assert(Number(task.notification_eligible || 0) === 1, 'Artifact prompt should be eligible');

    const bridge = await attemptManagedArtifactMaterializationBeforeTerminalRecovery(execution.execution_id, '', {
      requestId: execution.last_request_id,
      actorSource: 'test',
    });
    assert(bridge.ok, `Bridge should succeed on empty terminal payload: ${bridge.reason || 'unknown'}`);
    assert(bridge.required === true, 'Bridge should be required for artifact tasks');
    assert(String(bridge.successText || '').includes('execution-lessons.md'), `Unexpected bridge success text: ${bridge.successText}`);
    assert(bridge.materialized && bridge.materialized.ok, 'Materialization should succeed');

    const filePath = bridge.materialized.filePath;
    assert(fs.existsSync(filePath), 'Materialized artifact file missing');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    assert(fileContent.includes('# '), 'Artifact should have a markdown heading');
    assert(countBullets(fileContent) === 6, `Artifact should contain exactly 6 bullets, got ${countBullets(fileContent)}`);
    assert(fileContent.toLowerCase().includes('technical execution'), 'Artifact should discuss technical execution');
    assert(fileContent.toLowerCase().includes('infrastructure'), 'Artifact should discuss infrastructure projects');
    assert(!fileContent.toLowerCase().includes("i've got the request"), 'Artifact file must not contain only an acknowledgment');
    assert(bridge.materialized.contentHash === sha256(fileContent), 'Artifact hash mismatch');
    assert(Number(bridge.materialized.byteSize) === Buffer.byteLength(fileContent, 'utf8'), 'Artifact byte size mismatch');

    const artifactRow = await getExecutionArtifactByExecutionId(execution.execution_id);
    assert(artifactRow, 'execution_artifacts row missing');
    assert(artifactRow.verification_state === 'verified', `Expected verified artifact, got ${artifactRow.verification_state}`);
    const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
    assert(assessment, 'task_artifact_assessments row missing');
    assert(assessment.structure_state === TASK_ARTIFACT_STRUCTURE_STATES.VALID, `Expected valid structure, got ${assessment.structure_state}`);
    assert(assessment.alignment_state === TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED, `Expected aligned content, got ${assessment.alignment_state}`);
    assert(assessment.confidence_band === TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH, `Expected high confidence, got ${assessment.confidence_band}`);

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

    const liveTask = await getTaskById(task.task_id);
    assert(liveTask.current_state === TASK_STATES.COMPLETED, `Expected completed state, got ${liveTask.current_state}`);

    const summary = await getTaskCompletionSummaryByTaskId(task.task_id);
    assert(summary, 'Completion summary missing');
    assert(summary.final_state === TASK_STATES.COMPLETED, `Expected completed summary, got ${summary.final_state}`);

    return { task_id: task.task_id, execution_id: execution.execution_id };
  }

  async function runInvalidFilenameCase() {
    const prompt = 'Create a markdown file named execution-lessons.md with a short 6-bullet summary of what makes technical execution reliable in long-running infrastructure projects.';
    const { task, execution } = await createRunningTask(prompt, 'bridge_bad_filename');
    const bridge = await attemptManagedArtifactMaterializationBeforeTerminalRecovery(execution.execution_id, '', {
      requestId: execution.last_request_id,
      actorSource: 'test',
      filename: '../escape.md',
    });
    assert(bridge.ok === false, 'Invalid filename should fail');
    assert(bridge.reason === 'artifact_invalid', `Unexpected invalid filename reason: ${bridge.reason}`);
    assert(!fs.existsSync(bridge.filePath || ''), 'Invalid filename should not create a file');
    assert(!await getExecutionArtifactByExecutionId(execution.execution_id), 'Invalid filename should not persist artifact evidence');
    assert(!await getTaskArtifactAssessmentByTaskId(task.task_id), 'Invalid filename should not persist an assessment');

    await transitionExecution(execution.execution_id, EXECUTION_STATES.RECOVERY_REQUIRED, {
      requestId: execution.last_request_id,
      actorSource: 'test',
      reasonCode: 'artifact_output_invalid',
      recoveryReason: 'artifact_output_invalid',
      recoveryNotes: 'Invalid artifact filename rejected',
    });
    await transitionTask(task.task_id, TASK_STATES.RECOVERY_REQUIRED, {
      executionId: execution.execution_id,
      requestId: execution.last_request_id,
      actorSource: 'test',
      reasonCode: 'artifact_output_invalid',
      recoveryReason: 'artifact_output_invalid',
      message: 'Artifact output invalid.',
    });
    const liveTask = await getTaskById(task.task_id);
    assert(liveTask.current_state === TASK_STATES.RECOVERY_REQUIRED, `Expected recovery_required state, got ${liveTask.current_state}`);
  }

  async function runSimplePromptSkipCase() {
    const prompt = 'Reply with exactly DONE and nothing else.';
    const { task, execution } = await createRunningTask(prompt, 'bridge_simple');
    assert(task.task_kind === 'text_generation' || task.task_kind === 'simple_chat', `Expected simple text kind, got ${task.task_kind}`);
    assert(String(task.notification_policy || '') === 'silent', `Expected silent policy, got ${task.notification_policy}`);
    assert(Number(task.notification_eligible || 0) === 0, 'Simple prompt should not be proactive');

    const bridge = await attemptManagedArtifactMaterializationBeforeTerminalRecovery(execution.execution_id, '', {
      requestId: execution.last_request_id,
      actorSource: 'test',
    });
    assert(bridge.skipped === true, 'Simple prompt should skip artifact bridge');

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
  }

  await runBridgeHappyPath();
  await runInvalidFilenameCase();
  await runSimplePromptSkipCase();
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
