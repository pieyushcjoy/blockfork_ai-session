#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-task-completion-contract-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp

mkdir -p "$TMP_DIR/workspace/html"

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
  </body>
</html>
HTML

node - "$REPO_ROOT" "$DB_PATH" "$TMP_DIR" <<'NODE'
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));

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
  EXECUTION_STATES,
  TASK_STATES,
  TASK_ARTIFACT_CONFIDENCE_BANDS,
  ARTIFACT_VERIFICATION_STATES,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  prepareArtifactBindingForExecution,
  validateArtifactHonestyOrError,
  getTaskCompletionSummaryByTaskId,
} = runtime;

async function buildCompletedTask() {
  const sessionId = `completion_${Date.now()}_${crypto.randomUUID()}`;
  const requestId = `completion_req_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `completion_task_${crypto.randomUUID()}`,
    objectiveText: 'Create a premium landing page from this source page.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `completion_exec_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await transitionTask(task.task_id, TASK_STATES.ACKNOWLEDGED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
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

  const artifactPath = path.join(tmpDir, 'workspace', 'html', 'index.html');
  const binding = await prepareArtifactBindingForExecution(execution.execution_id, {
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
  }, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    timestamp: new Date().toISOString(),
  });
  assert(binding.ok, `Artifact binding failed: ${binding.reason || 'unknown'}`);

  const validation = await validateArtifactHonestyOrError({
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
  }, 'Created the landing page file and verified the result.', {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    meaningfulOutputStarted: true,
  });
  assert(validation === null, `Unexpected artifact honesty failure: ${validation?.message || 'unknown'}`);

  await transitionExecution(execution.execution_id, EXECUTION_STATES.COMPLETED, {
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });

  return { task, execution, artifactPath };
}

async function buildBlockedTask() {
  const sessionId = `blocked_${Date.now()}_${crypto.randomUUID()}`;
  const requestId = `blocked_req_${crypto.randomUUID()}`;
  const task = (await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `blocked_task_${crypto.randomUUID()}`,
    objectiveText: 'Create a landing page, but ask me which brand color to use.',
    actorSource: 'test',
    reasonCode: 'task_received',
  })).task;

  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `blocked_exec_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await transitionTask(task.task_id, TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'missing_user_choice',
    message: 'I am blocked and need your input to continue safely.',
  });

  return { task, execution };
}

(async () => {
  const completed = await buildCompletedTask();
  const completedSummary = await getTaskCompletionSummaryByTaskId(completed.task.task_id);
  assert(completedSummary, 'Completed task summary missing');
  assert(completedSummary.final_state === TASK_STATES.COMPLETED, `Unexpected completed final state: ${completedSummary.final_state}`);
  assert(completedSummary.summary_text.includes('completed successfully'), 'Completed summary text should state success');
  assert(completedSummary.follow_up_needed === 0, 'Completed task should not require follow-up');
  assert(completedSummary.execution_id === completed.execution.execution_id, 'Completed summary should point to completed execution');
  assert(completedSummary.proof.completed_execution_id === completed.execution.execution_id, 'Completed proof should pin completed execution');
  assert(Array.isArray(completedSummary.what_completed), 'Completed summary should expose completed milestones');
  assert(completedSummary.what_completed.includes('task accepted'), 'Completed summary missing task accepted milestone');
  assert(completedSummary.what_completed.includes('plan locked'), 'Completed summary missing plan locked milestone');
  assert(completedSummary.what_completed.includes('tool work started'), 'Completed summary missing tool work started milestone');
  assert(completedSummary.what_completed.includes('artifact created'), 'Completed summary missing artifact created milestone');
  assert(completedSummary.what_completed.includes('artifact verification started'), 'Completed summary missing verification start milestone');
  assert(completedSummary.what_completed.includes('artifact verified'), 'Completed summary missing artifact verified milestone');
  assert(completedSummary.what_completed.includes('task completed'), 'Completed summary missing task completed milestone');
  assert(completedSummary.verified.includes('task completed'), 'Completed summary missing verified task completion');
  assert(completedSummary.verified.includes('artifact exists'), 'Completed summary missing verified artifact existence');
  assert(completedSummary.verified.includes('artifact verified'), 'Completed summary missing verified artifact verification');
  assert(completedSummary.verified.includes('artifact structurally valid'), 'Completed summary missing verified structure');
  assert(completedSummary.verified.includes('artifact aligned to task'), 'Completed summary missing verified alignment');
  assert(completedSummary.not_verified.length === 0 || completedSummary.not_verified.every((item) => !item.includes('requires user input')), 'Completed summary should not require user input');
  assert(Array.isArray(completedSummary.artifacts) && completedSummary.artifacts.length === 1, 'Completed summary should expose one artifact');
  assert(completedSummary.artifacts[0].confidence_band === TASK_ARTIFACT_CONFIDENCE_BANDS.HIGH, 'Completed artifact confidence should be high');
  assert(completedSummary.artifacts[0].verification_state === ARTIFACT_VERIFICATION_STATES.VERIFIED, 'Completed artifact should be verified');

  const blocked = await buildBlockedTask();
  const blockedSummary = await getTaskCompletionSummaryByTaskId(blocked.task.task_id);
  assert(blockedSummary, 'Blocked task summary missing');
  assert(blockedSummary.final_state === TASK_STATES.BLOCKED_HUMAN_INPUT_REQUIRED, `Unexpected blocked final state: ${blockedSummary.final_state}`);
  assert(blockedSummary.summary_text.includes('blocked'), 'Blocked summary text should mention blocking');
  assert(blockedSummary.follow_up_needed === 1, 'Blocked task should require follow-up');
  assert(blockedSummary.not_verified.some((item) => item.includes('requires user input')), 'Blocked summary should mention missing user input');
  assert(blockedSummary.proof.failure_fact_id, 'Blocked summary should include failure fact proof');
  assert(blockedSummary.what_completed.includes('blocked human input required'), 'Blocked summary should include blocked milestone');

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const stmt = db.prepare(`
    SELECT task_id, final_state, summary_text, follow_up_needed, what_completed_json, artifacts_json, verified_json, not_verified_json, proof_json
    FROM task_completion_summaries
    WHERE task_id IN (?, ?)
    ORDER BY task_id ASC
  `);
  stmt.bind([blocked.task.task_id, completed.task.task_id]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  assert(rows.length === 2, 'Expected two durable completion summaries');

  console.log(JSON.stringify({
    status: 'pass',
    completed_task_id: completed.task.task_id,
    completed_summary_state: completedSummary.final_state,
    blocked_task_id: blocked.task.task_id,
    blocked_summary_state: blockedSummary.final_state,
    summary_count: rows.length,
    verified_persistence: true,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
