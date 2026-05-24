#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-task-failure-classification-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp

mkdir -p "$TMP_DIR/workspace/plain"
printf 'Draft notes for a landing page.\n' > "$TMP_DIR/workspace/plain/landing-page.txt"

node - "$REPO_ROOT" "$DB_PATH" "$TMP_DIR" <<'NODE'
const path = require('path');
const fs = require('fs');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const repoRoot = process.argv[2];
const tmpDir = process.argv[4];
process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = path.join(tmpDir, 'workspace');

const runtime = require(path.join(repoRoot, 'server.js'));
const {
  EXECUTION_STATES,
  TASK_STATES,
  TOOL_FAILURE_CATEGORIES,
  TOOL_FAILURE_SCOPES,
  ARTIFACT_VERIFICATION_STATES,
  createTaskRecord,
  createExecutionRecord,
  transitionExecution,
  transitionExecutionWithLease,
  transitionTask,
  prepareArtifactBindingForExecution,
  getToolFailureFactBySubjectId,
} = runtime;

async function buildWorkSession(label) {
  const sessionId = `failure_${label}_${Date.now()}`;
  const requestId = `failure_req_${label}_${Date.now()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `failure_task_${label}_${Date.now()}`,
    objectiveText: 'Create a landing page from this source page.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;
  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `failure_exec_${label}_${Date.now()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

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

  return { sessionId, task, execution, requestId };
}

async function expectFact(subjectType, subjectId, expectedCategory, expectedScope, label) {
  const fact = await getToolFailureFactBySubjectId(subjectType, subjectId);
  assert(fact, `Missing failure fact for ${label}`);
  assert(fact.failure_category === expectedCategory, `Unexpected category for ${label}: ${fact.failure_category}`);
  assert(fact.failure_scope === expectedScope, `Unexpected scope for ${label}: ${fact.failure_scope}`);
  return fact;
}

(async () => {
  const results = [];

  {
    const { execution } = await buildWorkSession('tool_not_invoked');
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      actorSource: 'test',
      requestId: execution.last_request_id,
      reasonCode: 'upstream_unreachable',
      notes: 'synthetic pre-output upstream failure',
      clearLease: true,
    });
    const fact = await expectFact('execution', execution.execution_id, TOOL_FAILURE_CATEGORIES.TOOL_NOT_INVOKED, TOOL_FAILURE_SCOPES.TOOL, 'tool_not_invoked');
    results.push({ label: 'tool_not_invoked', category: fact.failure_category });
  }

  {
    const { execution } = await buildWorkSession('context_collapsed');
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      actorSource: 'test',
      requestId: execution.last_request_id,
      reasonCode: 'context_window_exceeded',
      budgetRejectionReason: 'context_window_exceeded',
      notes: 'synthetic context window failure',
      clearLease: true,
    });
    const fact = await expectFact('execution', execution.execution_id, TOOL_FAILURE_CATEGORIES.CONTEXT_COLLAPSED, TOOL_FAILURE_SCOPES.CONTEXT, 'context_collapsed');
    results.push({ label: 'context_collapsed', category: fact.failure_category });
  }

  {
    const { execution } = await buildWorkSession('execution_interrupted');
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.RECOVERY_REQUIRED, {
      actorSource: 'test',
      requestId: execution.last_request_id,
      reasonCode: 'upstream_timeout',
      recoveryReason: 'ambiguous_stream_interruption',
      notes: 'synthetic interruption after meaningful output',
      meaningfulOutputStarted: true,
      clearLease: true,
    });
    const fact = await expectFact('execution', execution.execution_id, TOOL_FAILURE_CATEGORIES.EXECUTION_INTERRUPTED, TOOL_FAILURE_SCOPES.EXECUTION, 'execution_interrupted');
    results.push({ label: 'execution_interrupted', category: fact.failure_category });
  }

  {
    const { execution } = await buildWorkSession('artifact_missing');
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      actorSource: 'test',
      requestId: execution.last_request_id,
      reasonCode: 'artifact_path_not_found',
      artifactReason: 'artifact_path_not_found',
      artifactVerificationState: ARTIFACT_VERIFICATION_STATES.REJECTED,
      artifactExists: false,
      meaningfulOutputStarted: true,
      notes: 'synthetic missing artifact',
      clearLease: true,
    });
    const fact = await expectFact('execution', execution.execution_id, TOOL_FAILURE_CATEGORIES.ARTIFACT_MISSING, TOOL_FAILURE_SCOPES.ARTIFACT, 'artifact_missing');
    results.push({ label: 'artifact_missing', category: fact.failure_category });
  }

  {
    const { execution } = await buildWorkSession('status_claim_unverified');
    await transitionExecutionWithLease(execution.execution_id, EXECUTION_STATES.FAILED, {
      actorSource: 'test',
      requestId: execution.last_request_id,
      reasonCode: 'artifact_claim_without_evidence',
      artifactReason: 'artifact_claim_without_evidence',
      artifactVerificationState: ARTIFACT_VERIFICATION_STATES.REJECTED,
      artifactExists: false,
      meaningfulOutputStarted: true,
      notes: 'synthetic unverified status claim',
      clearLease: true,
    });
    const fact = await expectFact('execution', execution.execution_id, TOOL_FAILURE_CATEGORIES.STATUS_CLAIM_UNVERIFIED, TOOL_FAILURE_SCOPES.ARTIFACT, 'status_claim_unverified');
    results.push({ label: 'status_claim_unverified', category: fact.failure_category });
  }

  {
    const { execution } = await buildWorkSession('blocked_for_input');
    await transitionTask(execution.task_id, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, {
      executionId: execution.execution_id,
      requestId: execution.last_request_id,
      actorSource: 'test',
      reasonCode: 'missing_user_choice',
      notes: 'Need user to decide whether to overwrite',
    });
    const fact = await expectFact('task', execution.task_id, TOOL_FAILURE_CATEGORIES.BLOCKED_FOR_INPUT, TOOL_FAILURE_SCOPES.TASK, 'blocked_for_input');
    results.push({ label: 'blocked_for_input', category: fact.failure_category });
  }

  {
    const { execution } = await buildWorkSession('artifact_partial');
    const artifactPath = path.join(tmpDir, 'workspace', 'plain', 'landing-page.txt');
    const reqBody = {
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
    };
    const binding = await prepareArtifactBindingForExecution(execution.execution_id, reqBody, {
      requestId: execution.last_request_id,
      actorSource: 'test',
      timestamp: new Date().toISOString(),
    });
    assert(binding.ok, `Artifact binding failed unexpectedly: ${binding.reason || 'unknown'}`);
    const fact = await expectFact('task', execution.task_id, TOOL_FAILURE_CATEGORIES.ARTIFACT_PARTIAL, TOOL_FAILURE_SCOPES.ARTIFACT, 'artifact_partial');
    results.push({ label: 'artifact_partial', category: fact.failure_category });
  }

  console.log(JSON.stringify({
    status: 'pass',
    cases: results,
    case_count: results.length,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE

