#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-artifact-content-fidelity-XXXXXX)"
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

function countBullets(text) {
  return String(text || '').match(/^\s*[-*]\s+/gm)?.length || 0;
}

function isAckOnly(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes("i've got the request") || lower.includes("i'll write up that summary");
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
  TASK_ARTIFACT_STRUCTURE_STATES,
  TASK_ARTIFACT_ALIGNMENT_STATES,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  materializeVerifiedArtifactForExecution,
  validateArtifactHonestyOrError,
  getExecutionArtifactByExecutionId,
  getTaskArtifactAssessmentByTaskId,
  getTaskNotificationsByTaskId,
  getTaskCompletionSummaryByTaskId,
  getTaskById,
} = runtime;

async function createRunningArtifactTask(objectiveText, label) {
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

function artifactContractForPath(filePath) {
  return {
    metadata: {
      blockfork_artifact_contract: {
        requested: true,
        evidence: {
          path: filePath,
          delivery_requested: false,
          delivery_confirmed: false,
        },
      },
    },
  };
}

async function runHappyPath() {
  const prompt = 'Create a markdown file named project-summary.md with a short 5-bullet summary of why consistency matters in difficult projects.';
  const { task, execution } = await createRunningArtifactTask(prompt, 'happy');
  assert(task.task_kind === 'artifact_task', `Expected artifact_task, got ${task.task_kind}`);
  assert(task.notification_policy === 'progress_and_completion', `Expected progress_and_completion, got ${task.notification_policy}`);
  assert(Number(task.notification_eligible || 0) === 1, 'Artifact prompt should be eligible');

  const assistantAck = "I've got the request. I'll write up that summary for you.";
  const materialized = await materializeVerifiedArtifactForExecution(execution.execution_id, assistantAck, {
    requestId: execution.last_request_id,
    actorSource: 'test',
  });

  assert(materialized.ok, `Artifact materialization failed: ${materialized.reason || 'unknown'}`);
  assert(materialized.filename === 'project-summary.md', `Unexpected filename: ${materialized.filename}`);
  assert(materialized.artifactType === 'markdown', `Unexpected artifact type: ${materialized.artifactType}`);
  assert(fs.existsSync(materialized.filePath), 'Artifact file missing');
  assert(materialized.filePath.includes(path.join('artifacts', execution.execution_id)), 'Artifact not written inside execution artifacts directory');

  const fileContent = fs.readFileSync(materialized.filePath, 'utf8');
  assert(!isAckOnly(fileContent), 'Artifact file must not contain only the chat acknowledgement');
  assert(fileContent.startsWith('# Project Summary') || fileContent.startsWith('# project-summary'), 'Artifact should have a markdown heading');
  assert(countBullets(fileContent) === 5, `Artifact should contain exactly 5 bullets, got ${countBullets(fileContent)}`);
  assert(fileContent.toLowerCase().includes('consistency'), 'Artifact should discuss consistency');
  assert(fileContent.toLowerCase().includes('difficult'), 'Artifact should mention difficult projects');
  assert(materialized.contentHash === sha256(fileContent), 'Content hash mismatch');
  assert(Number(materialized.byteSize) === Buffer.byteLength(fileContent, 'utf8'), 'Byte size mismatch');

  const reqBody = artifactContractForPath(materialized.filePath);
  const validation = await validateArtifactHonestyOrError(reqBody, assistantAck, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    meaningfulOutputStarted: true,
  });
  assert(validation === null, `Happy-path artifact verification unexpectedly failed: ${validation?.code || validation?.message || 'unknown'}`);

  const artifactRow = await getExecutionArtifactByExecutionId(execution.execution_id);
  assert(artifactRow, 'execution_artifacts row missing');
  assert(artifactRow.verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED, `Artifact should be verified, got ${artifactRow.verification_state}`);
  assert(artifactRow.artifact_filename === 'project-summary.md', `Unexpected persisted filename: ${artifactRow.artifact_filename}`);
  assert(artifactRow.artifact_type === 'markdown', `Unexpected persisted artifact type: ${artifactRow.artifact_type}`);
  assert(artifactRow.content_hash === sha256(fileContent), 'Persisted hash mismatch');
  assert(Number(artifactRow.byte_size || 0) === Buffer.byteLength(fileContent, 'utf8'), 'Persisted byte size mismatch');

  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  assert(assessment, 'task_artifact_assessments row missing');
  assert(Number(assessment.artifact_exists || 0) === 1, 'Assessment should confirm artifact existence');
  assert(assessment.artifact_verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED, `Assessment should be verified, got ${assessment.artifact_verification_state}`);
  assert(assessment.artifact_family === 'markdown', `Expected markdown family, got ${assessment.artifact_family}`);
  assert(assessment.structure_state === TASK_ARTIFACT_STRUCTURE_STATES.VALID, `Expected valid structure, got ${assessment.structure_state}`);
  assert(assessment.alignment_state === TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED, `Expected aligned content, got ${assessment.alignment_state}`);
  assert(assessment.confidence_band === TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH, `Expected high confidence, got ${assessment.confidence_band}`);
  assert(Number(assessment.confidence_score || 0) >= 80, `Expected high confidence score, got ${assessment.confidence_score}`);

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

  const notifications = await getTaskNotificationsByTaskId(task.task_id);
  assert(Array.isArray(notifications) && notifications.length > 0, 'Expected lifecycle notifications for happy path');
  const lifecycleNotifications = notifications.filter((notification) => String(notification.notification_kind || '') !== 'artifact_delivery');
  const artifactDeliveryNotifications = notifications.filter((notification) => String(notification.notification_kind || '') === 'artifact_delivery');
  assert(lifecycleNotifications.length > 0, 'Expected artifact lifecycle notifications for happy path');
  assert(lifecycleNotifications.every((notification) => Number(notification.proactive_eligible || 0) === 1), 'Artifact lifecycle notifications should be proactive eligible');
  assert(lifecycleNotifications.every((notification) => String(notification.notification_policy || '') === 'progress_and_completion'), 'Artifact lifecycle notifications should use progress_and_completion');
  if (artifactDeliveryNotifications.length > 0) {
    assert(artifactDeliveryNotifications.every((notification) => Number(notification.proactive_eligible || 0) === 0), 'Artifact delivery notifications should be controlled only');
    assert(artifactDeliveryNotifications.every((notification) => String(notification.notification_policy || '') === 'completion_only'), 'Artifact delivery notifications should use completion_only');
  }

  return {
    task_id: task.task_id,
    execution_id: execution.execution_id,
    artifact_id: artifactRow.artifact_id || materialized.artifact?.artifact_id || null,
    notification_count: notifications.length,
  };
}

async function runSemanticFailureCase({ label, artifactContent, expectedReason }) {
  const prompt = 'Create a markdown file named project-summary.md with a short 5-bullet summary of why consistency matters in difficult projects.';
  const { task, execution } = await createRunningArtifactTask(prompt, label);
  const assistantAck = "I've got the request. I'll write up that summary for you.";
  const materialized = await materializeVerifiedArtifactForExecution(execution.execution_id, assistantAck, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    artifactContent,
  });

  assert(materialized.ok, `Materialization should still write the file for ${label}`);
  assert(fs.existsSync(materialized.filePath), `Artifact file missing for ${label}`);

  const validation = await validateArtifactHonestyOrError(artifactContractForPath(materialized.filePath), assistantAck, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    meaningfulOutputStarted: true,
  });
  assert(validation, `Expected semantic validation failure for ${label}`);
  assert(validation.code === expectedReason, `Unexpected failure code for ${label}: ${validation.code}`);

  const artifactRow = await getExecutionArtifactByExecutionId(execution.execution_id);
  assert(artifactRow, `execution_artifacts row missing for ${label}`);
  assert(artifactRow.verification_state === ARTIFACT_VERIFICATION_STATES.REJECTED, `Expected rejected artifact for ${label}, got ${artifactRow.verification_state}`);

  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  assert(assessment, `task_artifact_assessments row missing for ${label}`);
  assert(assessment.artifact_verification_state === ARTIFACT_VERIFICATION_STATES.REJECTED, `Assessment should be rejected for ${label}, got ${assessment.artifact_verification_state}`);
  assert(assessment.confidence_band !== TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH, `Expected non-high confidence for ${label}, got ${assessment.confidence_band}`);
  assert(
    assessment.structure_state === TASK_ARTIFACT_STRUCTURE_STATES.INVALID || assessment.alignment_state !== TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED,
    `Expected invalid or misaligned assessment for ${label}`,
  );

  const liveTask = await getTaskById(task.task_id);
  assert(liveTask.current_state === TASK_STATES.RECOVERY_REQUIRED, `Expected recovery_required for ${label}, got ${liveTask.current_state}`);

  const summary = await getTaskCompletionSummaryByTaskId(task.task_id);
  assert(summary && summary.final_state === TASK_STATES.RECOVERY_REQUIRED, `Expected recovery summary for ${label}`);

  return {
    task_id: task.task_id,
    execution_id: execution.execution_id,
    artifact_id: artifactRow.artifact_id || null,
    reason: validation.code,
  };
}

async function runSimplePromptRegression() {
  const prompt = 'Reply with exactly DONE and nothing else.';
  const { task, execution } = await createRunningArtifactTask(prompt, 'simple');
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

  return {
    task_id: task.task_id,
    notification_count: notifications.length,
  };
}

(async () => {
  const happy = await runHappyPath();
  const ackOnly = await runSemanticFailureCase({
    label: 'ack-only',
    artifactContent: "I've got the request. I'll write up that summary for you.",
    expectedReason: 'artifact_semantic_verification_failed',
  });
  const malformed = await runSemanticFailureCase({
    label: 'malformed',
    artifactContent: 'Just a note about lunch and errands.',
    expectedReason: 'artifact_semantic_verification_failed',
  });
  const wrongBullets = await runSemanticFailureCase({
    label: 'wrong-bullets',
    artifactContent: '# Notes\n\n- apples\n- bananas\n',
    expectedReason: 'artifact_semantic_verification_failed',
  });
  const simple = await runSimplePromptRegression();

  console.log(JSON.stringify({
    status: 'pass',
    happy_path: happy,
    negative_cases: [ackOnly, malformed, wrongBullets],
    simple_prompt: simple,
    checks: [
      'markdown file contains a 5-bullet summary',
      'acknowledgment-only file fails semantic verification',
      'malformed markdown fails semantic verification',
      'wrong bullet count fails semantic verification',
      'execution_artifacts row exists',
      'task_artifact_assessments row exists',
      'final task is completed only when content passes',
      'recovery_required when content is invalid',
      'simple prompts remained silent',
    ],
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
