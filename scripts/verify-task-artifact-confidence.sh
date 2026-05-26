#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-task-artifact-confidence-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp

mkdir -p "$TMP_DIR/workspace/html" "$TMP_DIR/workspace/md" "$TMP_DIR/workspace/plain"

cat > "$TMP_DIR/workspace/html/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Premium Landing Page</title>
  </head>
  <body>
    <header>
      <h1>Launch faster with BlockFork</h1>
    </header>
    <main>
      <section>
        <h2>Features</h2>
        <p>Durable task truth and artifact confidence for real workflows.</p>
        <button>Get Started</button>
      </section>
      <section>
        <h2>Why it works</h2>
        <p>Each artifact is verified, scored, and tracked across task attempts.</p>
      </section>
    </main>
    <footer>Built from the source page.</footer>
  </body>
</html>
HTML

cat > "$TMP_DIR/workspace/md/brief.md" <<'MD'
# Repo Brief

## Summary

- Durable execution truth is complete.
- Task truth now spans multiple executions.
- Artifact confidence should distinguish existence from adequacy.
- This repository brief keeps the verification layers easy to follow.

## Notes

1. Use the verification layers already in place.
2. Keep the scoring lightweight.
3. Prefer task-aware confidence over binary checks.
MD

cat > "$TMP_DIR/workspace/plain/landing-page.txt" <<'TXT'
Draft notes

Use a clean hero, a CTA, and some product copy.
TXT

node - "$REPO_ROOT" "$DB_PATH" "$TMP_DIR" <<'NODE'
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const repoRoot = process.argv[2];
const dbPath = process.argv[3];
const tmpDir = process.argv[4];
process.env.BLOCKFORK_WORKSPACE_ALLOWED_ROOTS = path.join(tmpDir, 'workspace');

const runtime = require(path.join(repoRoot, 'server.js'));

const {
  TASK_ARTIFACT_STRUCTURE_STATES,
  TASK_ARTIFACT_ALIGNMENT_STATES,
  TASK_ARTIFACT_CONFIDENCE_BANDS,
  ARTIFACT_VERIFICATION_STATES,
  createTaskRecord,
  createExecutionRecord,
  prepareArtifactBindingForExecution,
  validateArtifactHonestyOrError,
  getTaskArtifactAssessmentByTaskId,
  getTaskById,
} = runtime;

async function runCase({
  objectiveText,
  relativePath,
  completionText,
  expectedBand,
  expectedStructure,
  expectedAlignment,
  expectedVerification,
  minimumScore,
  label,
  expectedValidationCode = null,
  expectedFinalState = null,
}) {
  const sessionId = `artifact_conf_${label}_${Date.now()}`;
  const requestId = `artifact_conf_req_${label}_${Date.now()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `artifact_conf_${label}`,
    objectiveText,
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;
  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `artifact_conf_exec_${label}`,
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

  const absolutePath = path.join(tmpDir, 'workspace', relativePath);
  const reqBody = {
    metadata: {
      blockfork_artifact_contract: {
        requested: true,
        evidence: {
          path: absolutePath,
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
  assert(binding.ok, `Artifact binding failed for ${label}: ${binding.reason || 'unknown'}`);

  const result = await validateArtifactHonestyOrError(reqBody, completionText, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    meaningfulOutputStarted: true,
  });
  if (expectedValidationCode) {
    assert(result, `Artifact honesty check should have failed for ${label}`);
    assert(result.code === expectedValidationCode, `Unexpected validation code for ${label}: ${result?.code || 'unknown'}`);
  } else {
    assert(result === null, `Artifact honesty check unexpectedly failed for ${label}: ${result?.message || 'unknown'}`);
  }

  const assessment = await getTaskArtifactAssessmentByTaskId(task.task_id);
  assert(assessment, `No artifact assessment persisted for ${label}`);
  assert(assessment.confidence_band === expectedBand, `Unexpected confidence band for ${label}: ${assessment.confidence_band}`);
  assert(assessment.structure_state === expectedStructure, `Unexpected structure state for ${label}: ${assessment.structure_state}`);
  assert(assessment.alignment_state === expectedAlignment, `Unexpected alignment state for ${label}: ${assessment.alignment_state}`);
  assert(assessment.artifact_verification_state === expectedVerification, `Unexpected verification state for ${label}: ${assessment.artifact_verification_state}`);
  assert(assessment.confidence_score >= minimumScore, `Confidence score too low for ${label}: ${assessment.confidence_score}`);
  assert(String(assessment.task_id || '') === task.task_id, `Assessment task mismatch for ${label}`);

  const liveTask = await getTaskById(task.task_id);
  if (expectedFinalState) {
    assert(liveTask.current_state === expectedFinalState, `Unexpected final state for ${label}: ${liveTask.current_state}`);
  } else {
    assert(liveTask.current_state === 'artifact_verified' || liveTask.current_state === 'completed', `Task did not advance to artifact_verified for ${label}: ${liveTask.current_state}`);
  }

  return {
    task_id: task.task_id,
    execution_id: execution.execution_id,
    assessment,
  };
}

(async () => {
  const html = await runCase({
    label: 'html',
    objectiveText: 'Create a premium landing page from this source page.',
    relativePath: 'html/index.html',
    completionText: 'Created and verified the landing page files.',
    expectedBand: TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH,
    expectedStructure: TASK_ARTIFACT_STRUCTURE_STATES.VALID,
    expectedAlignment: TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED,
    expectedVerification: ARTIFACT_VERIFICATION_STATES.VERIFIED,
    minimumScore: 80,
  });

  const markdown = await runCase({
    label: 'markdown',
    objectiveText: 'Create a concise markdown brief summarizing the repository.',
    relativePath: 'md/brief.md',
    completionText: 'Created a markdown brief and verified the file exists.',
    expectedBand: TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH,
    expectedStructure: TASK_ARTIFACT_STRUCTURE_STATES.VALID,
    expectedAlignment: TASK_ARTIFACT_ALIGNMENT_STATES.ALIGNED,
    expectedVerification: ARTIFACT_VERIFICATION_STATES.VERIFIED,
    minimumScore: 80,
  });

  const partial = await runCase({
    label: 'partial',
    objectiveText: 'Create a landing page from this source page.',
    relativePath: 'plain/landing-page.txt',
    completionText: 'I created a draft file with notes and next steps.',
    expectedBand: TASK_ARTIFACT_CONFIDENCE_BANDS.LOW,
    expectedStructure: TASK_ARTIFACT_STRUCTURE_STATES.INVALID,
    expectedAlignment: TASK_ARTIFACT_ALIGNMENT_STATES.MISMATCH,
    expectedVerification: ARTIFACT_VERIFICATION_STATES.REJECTED,
    minimumScore: 0,
    expectedValidationCode: 'artifact_semantic_verification_failed',
    expectedFinalState: runtime.TASK_STATES.RECOVERY_REQUIRED,
  });

  console.log(JSON.stringify({
    status: 'pass',
    cases: [
      {
        label: 'html',
        task_id: html.task_id,
        confidence_band: html.assessment.confidence_band,
        confidence_score: html.assessment.confidence_score,
      },
      {
        label: 'markdown',
        task_id: markdown.task_id,
        confidence_band: markdown.assessment.confidence_band,
        confidence_score: markdown.assessment.confidence_score,
      },
      {
        label: 'partial',
        task_id: partial.task_id,
        confidence_band: partial.assessment.confidence_band,
        confidence_score: partial.assessment.confidence_score,
      },
    ],
    task_count: 3,
    bands: [
      html.assessment.confidence_band,
      markdown.assessment.confidence_band,
      partial.assessment.confidence_band,
    ],
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
