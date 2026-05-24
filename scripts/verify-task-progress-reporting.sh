#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"
TMP_DIR="$(mktemp -d /private/tmp/blockfork-task-progress-reporting-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node
require_cmd mktemp

mkdir -p "$TMP_DIR/workspace/html" "$TMP_DIR/workspace/blocking"

cat > "$TMP_DIR/workspace/html/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Progress Reporting Check</title>
  </head>
  <body>
    <header>
      <h1>BlockFork Progress Reporting</h1>
    </header>
    <main>
      <section>
        <h2>Milestones</h2>
        <p>Task accepted, plan locked, tool work started, artifact created, and verification complete.</p>
      </section>
    </main>
  </body>
</html>
HTML

node - "$REPO_ROOT" "$DB_PATH" "$TMP_DIR" <<'NODE'
const path = require('path');
const fs = require('fs');

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
  TASK_PROGRESS_CATEGORIES,
  ARTIFACT_VERIFICATION_STATES,
  TOOL_FAILURE_CATEGORIES,
  TOOL_FAILURE_SCOPES,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  prepareArtifactBindingForExecution,
  validateArtifactHonestyOrError,
  getTaskProgressEventsByTaskId,
  getToolFailureFactBySubjectId,
  getTaskById,
} = runtime;

async function buildHappyPathTask(label) {
  const sessionId = `progress_${label}_${Date.now()}`;
  const requestId = `progress_req_${label}_${Date.now()}`;
  const taskResult = await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `progress_task_${label}_${Date.now()}`,
    objectiveText: 'Create a premium landing page from this source page.',
    actorSource: 'test',
    reasonCode: 'task_received',
  });
  const task = taskResult.task;
  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `progress_exec_${label}_${Date.now()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  })).execution;

  await transitionTask(task.task_id, TASK_STATES.ACKNOWLEDGED, {
    executionId: execution.execution_id,
    requestId: execution.last_request_id,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
    message: 'Task accepted. I am starting the work now.',
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

  const completionText = 'Created the landing page file and verified the result.';
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
  }, completionText, {
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

async function buildBlockedTask(label) {
  const sessionId = `progress_blocked_${label}_${Date.now()}`;
  const requestId = `progress_blocked_req_${label}_${Date.now()}`;
  const taskResult = await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `progress_blocked_task_${label}_${Date.now()}`,
    objectiveText: 'Create a landing page, but ask me which brand color to use.',
    actorSource: 'test',
    reasonCode: 'task_received',
  });
  const task = taskResult.task;
  const execution = (await createExecutionRecord({
    sessionId,
    requestId: `${requestId}_exec`,
    idempotencyKey: `progress_blocked_exec_${label}_${Date.now()}`,
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
  const happy = await buildHappyPathTask('happy');
  const happyEvents = await getTaskProgressEventsByTaskId(happy.task.task_id);
  const happyCategories = happyEvents.map((event) => event.progress_category);

  const expectedHappyCategories = [
    TASK_PROGRESS_CATEGORIES.TASK_ACCEPTED,
    TASK_PROGRESS_CATEGORIES.PLAN_LOCKED,
    TASK_PROGRESS_CATEGORIES.TOOL_WORK_STARTED,
    TASK_PROGRESS_CATEGORIES.ARTIFACT_CREATED,
    TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFICATION_STARTED,
    TASK_PROGRESS_CATEGORIES.ARTIFACT_VERIFIED,
    TASK_PROGRESS_CATEGORIES.TASK_COMPLETED,
  ];

  assert(happyCategories.length === expectedHappyCategories.length, `Expected ${expectedHappyCategories.length} progress events, found ${happyCategories.length}`);
  expectedHappyCategories.forEach((category, index) => {
    assert(happyCategories[index] === category, `Progress event ${index + 1} should be ${category}, found ${happyCategories[index]}`);
  });

  const happyMessages = happyEvents.map((event) => event.message_text);
  assert(happyMessages[0].includes('starting the work'), 'Task accepted message missing');
  assert(happyMessages[4].includes('verification is starting'), 'Artifact verification start message missing');
  assert(happyMessages[5].includes('verified'), 'Artifact verified message missing');
  assert(happyEvents[4].decision === 'notify_user', 'Artifact verification start should notify user');
  assert(happyEvents[4].requires_user_input === 0, 'Artifact verification start should not require user input');

  const happyTask = await getTaskById(happy.task.task_id);
  assert(happyTask.current_state === TASK_STATES.COMPLETED, `Happy task should be completed, found ${happyTask.current_state}`);

  const happyFact = await getToolFailureFactBySubjectId('task', happy.task.task_id);
  assert(!happyFact, 'Happy task should not create a failure fact');

  const blocked = await buildBlockedTask('blocked');
  const blockedEvents = await getTaskProgressEventsByTaskId(blocked.task.task_id);
  const blockedEvent = blockedEvents.find((event) => event.progress_category === TASK_PROGRESS_CATEGORIES.BLOCKED_HUMAN_INPUT_REQUIRED);
  assert(blockedEvent, 'Missing blocked human input progress event');
  assert(blockedEvent.decision === 'interrupt_user', 'Blocked event should interrupt user');
  assert(blockedEvent.requires_user_input === 1, 'Blocked event should require user input');
  assert(blockedEvent.message_text.includes('need your input'), 'Blocked event message should ask for input');

  const blockedFact = await getToolFailureFactBySubjectId('task', blocked.task.task_id);
  assert(blockedFact, 'Blocked task should create a failure fact');
  assert(blockedFact.failure_category === TOOL_FAILURE_CATEGORIES.BLOCKED_FOR_INPUT, `Unexpected blocked failure category: ${blockedFact.failure_category}`);
  assert(blockedFact.failure_scope === TOOL_FAILURE_SCOPES.TASK, `Unexpected blocked failure scope: ${blockedFact.failure_scope}`);

  console.log(JSON.stringify({
    status: 'pass',
    happy_task_id: happy.task.task_id,
    happy_progress_categories: happyCategories,
    blocked_task_id: blocked.task.task_id,
    blocked_progress_category: blockedEvent.progress_category,
    blocked_decision: blockedEvent.decision,
    blocked_requires_user_input: blockedEvent.requires_user_input,
    artifact_verification_state: ARTIFACT_VERIFICATION_STATES.VERIFIED,
    verified_persistence: true,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE
