#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-verified-artifact-file-execution-XXXXXX)"
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

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID()}`;
}

const tmpDir = process.argv[2];
const repoRoot = tmpDir;
const workspaceRoot = path.join(tmpDir, 'workspace');
process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = workspaceRoot;

const runtime = require(path.join(repoRoot, 'server.js'));

const {
  TASK_STATES,
  EXECUTION_STATES,
  ARTIFACT_VERIFICATION_STATES,
  TASK_ARTIFACT_CONFIDENCE_BANDS,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  materializeVerifiedArtifactForExecution,
  getExecutionArtifactByExecutionId,
  getTaskArtifactAssessmentByTaskId,
  getTaskNotificationsByTaskId,
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

  assert(task.task_kind === 'artifact_task' || task.task_kind === 'text_generation' || task.task_kind === 'simple_chat' || task.task_kind === 'website_task' || task.task_kind === 'code_task', `Unexpected task kind for ${label}: ${task.task_kind}`);

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

  return { task, execution, sessionId, requestId };
}

function setWorkspaceRoot(rootPath) {
  process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = rootPath;
}

async function runHappyPath() {
  const objectiveText = 'Create a markdown file named project-summary.md with a short 5-bullet summary of why consistency matters in difficult projects.';
  setWorkspaceRoot(workspaceRoot);
  const { task, execution } = await createRunningTask(objectiveText, 'happy');
  assert(task.task_kind === 'artifact_task', `Expected artifact_task at admission, got ${task.task_kind}`);
  assert(task.notification_policy === 'progress_and_completion', `Expected progress_and_completion, got ${task.notification_policy}`);
  assert(Number(task.notification_eligible || 0) === 1, 'Artifact prompt should be notification eligible');

  const content = `# project-summary\n\n- Consistency reduces rework.\n- It improves trust across difficult projects.\n- Clear habits keep teams moving when pressure rises.\n- Small repeated wins compound into momentum.\n- Predictability makes handoffs safer and faster.`;
  const expectedHash = sha256(content);

  const materialized = await materializeVerifiedArtifactForExecution(execution.execution_id, content, {
    requestId: execution.last_request_id,
    actorSource: 'test',
  });
  assert(materialized.ok, `Artifact materialization failed: ${materialized.reason || 'unknown'}`);
  assert(materialized.required === true, 'Artifact materialization should be required for artifact tasks');
  assert(materialized.filename === 'project-summary.md', `Unexpected artifact filename: ${materialized.filename}`);
  assert(materialized.artifactType === 'markdown', `Unexpected artifact type: ${materialized.artifactType}`);
  assert(fs.existsSync(materialized.filePath), 'Verified artifact file does not exist');
  assert(path.relative(path.join(workspaceRoot, 'artifacts'), materialized.filePath).split(path.sep)[0] !== '..', 'Verified artifact escaped the allowed workspace artifact directory');
  const fileContent = fs.readFileSync(materialized.filePath, 'utf8');
  assert(fileContent === content, 'Written artifact content mismatch');
  assert(materialized.contentHash === expectedHash, 'Returned content hash mismatch');
  assert(sha256(fileContent) === expectedHash, 'File hash mismatch');
  assert(Number(materialized.byteSize) === Buffer.byteLength(content, 'utf8'), 'Returned byte size mismatch');
  assert(materialized.artifact?.verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Artifact should be verified');

  const artifactRow = await getExecutionArtifactByExecutionId(execution.execution_id);
  assert(artifactRow, 'execution_artifacts row missing for happy path');
  assert(artifactRow.artifact_filename === 'project-summary.md', `Persisted artifact filename mismatch: ${artifactRow.artifact_filename}`);
  assert(artifactRow.artifact_type === 'markdown', `Persisted artifact type mismatch: ${artifactRow.artifact_type}`);
  assert(artifactRow.content_hash === expectedHash, 'Persisted content hash mismatch');
  assert(Number(artifactRow.byte_size || 0) === Buffer.byteLength(content, 'utf8'), 'Persisted byte size mismatch');
  assert(artifactRow.verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Persisted artifact should be verified');
  assert(path.normalize(artifactRow.canonical_path || '') === path.normalize(materialized.filePath), 'Persisted canonical path mismatch');

  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  assert(assessment, 'task_artifact_assessments row missing for happy path');
  assert(Number(assessment.artifact_exists || 0) === 1, 'Assessment should confirm artifact existence');
  assert(assessment.artifact_verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Assessment should be verified');
  assert(assessment.artifact_family === 'markdown', `Expected markdown artifact family, got ${assessment.artifact_family}`);
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
  assert(liveTask.current_state === TASK_STATES.COMPLETED, `Happy-path task should complete, got ${liveTask.current_state}`);

  const summary = await getTaskCompletionSummaryByTaskId(task.task_id);
  assert(summary, 'Completion summary missing for happy path');
  assert(summary.final_state === TASK_STATES.COMPLETED, `Unexpected happy-path final state: ${summary.final_state}`);
  assert(summary.summary_text === 'Task completed successfully.', `Unexpected completion summary text: ${summary.summary_text}`);
  assert(Array.isArray(summary.what_completed) && summary.what_completed.includes('artifact created'), 'Happy-path summary missing artifact created');
  assert(Array.isArray(summary.verified) && summary.verified.includes('artifact verified'), 'Happy-path summary missing artifact verified');
  assert(Array.isArray(summary.artifacts) && summary.artifacts.length === 1, 'Happy-path summary should expose one artifact');
  assert(summary.artifacts[0].verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Happy-path summary artifact should be verified');

  const notifications = await getTaskNotificationsByTaskId(task.task_id);
  assert(Array.isArray(notifications) && notifications.length > 0, 'Expected notifications for happy path');
  assert(notifications.every((notification) => Number(notification.proactive_eligible || 0) === 1), 'Happy-path notifications should be proactive eligible');
  assert(notifications.every((notification) => String(notification.notification_policy || '') === 'progress_and_completion'), 'Happy-path notifications should use progress_and_completion policy');

  return {
    task_id: task.task_id,
    execution_id: execution.execution_id,
    artifact_id: artifactRow.artifact_id || materialized.artifact?.artifact_id || null,
    notification_count: notifications.length,
  };
}

async function runTraversalGuardCase(label, filename, expectedReason) {
  setWorkspaceRoot(workspaceRoot);
  const { task, execution } = await createRunningTask(
    'Create a markdown file named project-summary.md with a short 5-bullet summary of why consistency matters in difficult projects.',
    label,
  );
  const result = await materializeVerifiedArtifactForExecution(execution.execution_id, '# project-summary\n\n- one\n- two\n', {
    requestId: execution.last_request_id,
    actorSource: 'test',
    filename,
  });
  assert(result.ok === false, `${label} should fail`);
  assert(result.reason === expectedReason, `${label} expected reason ${expectedReason}, got ${result.reason}`);
  assert(!fs.existsSync(result.filePath || ''), `${label} should not create a file`);
  const artifactRow = await getExecutionArtifactByExecutionId(execution.execution_id);
  assert(!artifactRow, `${label} should not persist an artifact row`);
  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  assert(!assessment, `${label} should not persist an assessment`);
}

async function runSymlinkEscapeCase() {
  const symlinkRoot = path.join(tmpDir, 'workspace-symlink');
  const canonicalTarget = path.join(tmpDir, 'workspace-symlink-target');
  fs.mkdirSync(canonicalTarget, { recursive: true });
  fs.mkdirSync(symlinkRoot, { recursive: true });
  const symlinkArtifacts = path.join(symlinkRoot, 'artifacts');
  try {
    fs.symlinkSync(canonicalTarget, symlinkArtifacts, 'dir');
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  setWorkspaceRoot(symlinkRoot);
  const { execution } = await createRunningTask(
    'Create a markdown file named project-summary.md with a short 5-bullet summary of why consistency matters in difficult projects.',
    'symlink',
  );
  const result = await materializeVerifiedArtifactForExecution(execution.execution_id, '# project-summary\n\n- one\n- two\n', {
    requestId: execution.last_request_id,
    actorSource: 'test',
  });
  assert(result.ok === false, 'symlink escape should fail');
  assert(result.reason === 'artifact_path_symlink_escape', `Expected symlink escape, got ${result.reason}`);
  assert(!fs.existsSync(result.filePath || ''), 'Symlink escape should not create a file');
}

async function runFailureCase() {
  setWorkspaceRoot(workspaceRoot);
  const { task, execution } = await createRunningTask(
    'Create a markdown file named project-summary.md with a short 5-bullet summary of why consistency matters in difficult projects.',
    'failure',
  );

  const originalRename = fs.renameSync;
  fs.renameSync = function patchedRenameSync(...args) {
    throw new Error('simulated rename failure');
  };

  let result;
  try {
    result = await materializeVerifiedArtifactForExecution(execution.execution_id, '# project-summary\n\n- one\n- two\n', {
      requestId: execution.last_request_id,
      actorSource: 'test',
    });
  } finally {
    fs.renameSync = originalRename;
  }

  assert(result.ok === false, 'Simulated write failure should fail');
  assert(result.reason === 'artifact_output_invalid' || String(result.reason || '').includes('simulated rename failure'), `Unexpected failure reason: ${result.reason}`);
  const artifactRow = await getExecutionArtifactByExecutionId(execution.execution_id);
  assert(!artifactRow, 'Simulated write failure should not persist an artifact row');
  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  assert(!assessment, 'Simulated write failure should not persist an assessment');
}

async function runSimplePromptRegression() {
  setWorkspaceRoot(workspaceRoot);
  const { task, execution } = await createRunningTask('Reply with exactly DONE and nothing else.', 'simple');
  assert(task.task_kind === 'text_generation' || task.task_kind === 'simple_chat', `Simple prompt should remain text-like, got ${task.task_kind}`);
  assert(task.notification_policy === 'silent', `Simple prompt should be silent, got ${task.notification_policy}`);
  assert(Number(task.notification_eligible || 0) === 0, 'Simple prompt should not be notification eligible');

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

  const notifications = await getTaskNotificationsByTaskId(task.task_id);
  assert(Array.isArray(notifications) && notifications.length > 0, 'Simple prompt should still produce lifecycle notifications');
  assert(notifications.every((notification) => Number(notification.proactive_eligible || 0) === 0), 'Simple prompt notifications should be suppressed');
  assert(notifications.every((notification) => String(notification.notification_policy || '') === 'silent'), 'Simple prompt notifications should remain silent');
  assert(notifications.every((notification) => String(notification.delivery_suppressed_reason || '') !== ''), 'Simple prompt should explain suppression');
  const summary = await getTaskCompletionSummaryByTaskId(task.task_id);
  assert(summary && summary.final_state === TASK_STATES.COMPLETED, 'Simple prompt should complete normally');
  return {
    task_id: task.task_id,
    notification_count: notifications.length,
  };
}

(async () => {
  const happy = await runHappyPath();
  await runTraversalGuardCase('path-traversal', '../escape.md', 'artifact_invalid');
  await runTraversalGuardCase('absolute-path', '/private/tmp/escape.md', 'artifact_invalid');
  await runSymlinkEscapeCase();
  await runFailureCase();
  const simple = await runSimplePromptRegression();

  console.log(JSON.stringify({
    status: 'pass',
    happy_path: happy,
    simple_prompt: simple,
    checks: [
      'markdown file creation succeeded',
      'execution_artifacts row exists',
      'task_artifact_assessments row exists',
      'hash matches file content',
      'byte size matches file content',
      'path traversal rejected',
      'absolute path rejected',
      'symlink escape rejected',
      'simulated write failure did not fake success',
      'simple prompts remained silent',
    ],
  }));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
NODE
