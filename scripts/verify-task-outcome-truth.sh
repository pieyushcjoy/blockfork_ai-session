#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd node

node - "$REPO_ROOT" "$DB_PATH" <<'NODE'
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));

const repoRoot = process.argv[2];
const dbPath = process.argv[3];
const runtime = require(path.join(repoRoot, 'server.js'));

const {
  EXECUTION_STATES,
  TASK_STATES,
  createTaskRecord,
  createExecutionRecord,
  transitionTask,
  transitionExecution,
  getTaskById,
  getExecutionById,
} = runtime;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  const sessionId = `task_truth_session_${crypto.randomUUID()}`;
  const objectiveText = 'Build me a website from this source page';
  const requestId = `task_truth_req_${crypto.randomUUID()}`;
  const exec1RequestId = `${requestId}_exec1`;
  const exec2RequestId = `${requestId}_exec2`;

  const taskResult = await createTaskRecord({
    sessionId,
    requestId,
    idempotencyKey: `task_truth_${crypto.randomUUID()}`,
    objectiveText,
    actorSource: 'test',
    reasonCode: 'task_received',
  });

  const task = taskResult.task;
  assert(task.current_state === TASK_STATES.RECEIVED, 'Task should start in received state');

  const exec1Result = await createExecutionRecord({
    sessionId,
    requestId: exec1RequestId,
    idempotencyKey: `exec1_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  });
  const exec1 = exec1Result.execution;

  await transitionTask(task.task_id, TASK_STATES.ACKNOWLEDGED, {
    executionId: exec1.execution_id,
    requestId: exec1RequestId,
    actorSource: 'test',
    reasonCode: 'task_acknowledged',
  });
  await transitionExecution(exec1.execution_id, EXECUTION_STATES.QUEUED, {
    requestId: exec1RequestId,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await transitionExecution(exec1.execution_id, EXECUTION_STATES.RUNNING, {
    requestId: exec1RequestId,
    actorSource: 'test',
    reasonCode: 'request_running',
  });
  await transitionExecution(exec1.execution_id, EXECUTION_STATES.RECOVERY_REQUIRED, {
    requestId: exec1RequestId,
    actorSource: 'test',
    reasonCode: 'upstream_timeout',
    recoveryReason: 'tool_step_timeout',
    recoveryNotes: 'Synthetic mid-workflow interruption for task truth verification',
  });

  const exec2Result = await createExecutionRecord({
    sessionId,
    requestId: exec2RequestId,
    idempotencyKey: `exec2_${crypto.randomUUID()}`,
    taskId: task.task_id,
    actorSource: 'test',
    reasonCode: 'request_admitted',
  });
  const exec2 = exec2Result.execution;

  await transitionExecution(exec2.execution_id, EXECUTION_STATES.QUEUED, {
    requestId: exec2RequestId,
    actorSource: 'test',
    reasonCode: 'request_queued',
  });
  await transitionExecution(exec2.execution_id, EXECUTION_STATES.RUNNING, {
    requestId: exec2RequestId,
    actorSource: 'test',
    reasonCode: 'request_running',
  });
  await transitionExecution(exec2.execution_id, EXECUTION_STATES.COMPLETED, {
    requestId: exec2RequestId,
    actorSource: 'test',
    reasonCode: 'request_completed',
  });

  const liveTask = await getTaskById(task.task_id);
  assert(liveTask, 'Task should be readable through the runtime helper');
  assert(liveTask.current_state === TASK_STATES.COMPLETED, `Task should end completed, found ${liveTask.current_state}`);
  assert(liveTask.first_execution_id === exec1.execution_id, 'Task should retain first execution id');
  assert(liveTask.last_execution_id === exec2.execution_id, 'Task should retain last execution id');
  assert(liveTask.completed_execution_id === exec2.execution_id, 'Task should record completed execution id');

  const liveExec1 = await getExecutionById(exec1.execution_id);
  const liveExec2 = await getExecutionById(exec2.execution_id);
  assert(liveExec1.current_state === EXECUTION_STATES.RECOVERY_REQUIRED, 'First execution should end in recovery_required');
  assert(liveExec2.current_state === EXECUTION_STATES.COMPLETED, 'Second execution should end completed');

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const taskStmt = db.prepare(`
    SELECT task_id, session_id, current_state, first_execution_id, last_execution_id, completed_execution_id, objective_text
    FROM tasks
    WHERE task_id = ?
    LIMIT 1
  `);
  taskStmt.bind([task.task_id]);
  assert(taskStmt.step(), 'Task record missing from durable store');
  const taskRow = taskStmt.getAsObject();
  taskStmt.free();

  assert(String(taskRow.session_id || '') === sessionId, 'Durable task session mismatch');
  assert(String(taskRow.current_state || '') === TASK_STATES.COMPLETED, 'Durable task should be completed');
  assert(String(taskRow.first_execution_id || '') === exec1.execution_id, 'Durable task first execution mismatch');
  assert(String(taskRow.last_execution_id || '') === exec2.execution_id, 'Durable task last execution mismatch');
  assert(String(taskRow.completed_execution_id || '') === exec2.execution_id, 'Durable task completed execution mismatch');
  assert(String(taskRow.objective_text || '') === objectiveText, 'Durable task objective mismatch');

  const eventStmt = db.prepare(`
    SELECT new_state
    FROM task_events
    WHERE task_id = ?
    ORDER BY created_at ASC, rowid ASC
  `);
  eventStmt.bind([task.task_id]);
  const states = [];
  while (eventStmt.step()) {
    states.push(String(eventStmt.getAsObject().new_state || ''));
  }
  eventStmt.free();

  const expectedStates = [
    TASK_STATES.RECEIVED,
    TASK_STATES.ACKNOWLEDGED,
    TASK_STATES.PLANNED,
    TASK_STATES.TOOL_WORK_STARTED,
    TASK_STATES.RECOVERY_REQUIRED,
    TASK_STATES.PLANNED,
    TASK_STATES.TOOL_WORK_STARTED,
    TASK_STATES.COMPLETED,
  ];

  assert(states.length === expectedStates.length, `Expected ${expectedStates.length} task events, found ${states.length}`);
  expectedStates.forEach((state, index) => {
    assert(states[index] === state, `Task event ${index + 1} should be ${state}, found ${states[index]}`);
  });

  const execStmt = db.prepare(`
    SELECT execution_id, task_id, current_state
    FROM executions
    WHERE execution_id IN (?, ?)
    ORDER BY execution_id
  `);
  execStmt.bind([exec1.execution_id, exec2.execution_id]);
  const execRows = [];
  while (execStmt.step()) {
    execRows.push(execStmt.getAsObject());
  }
  execStmt.free();

  assert(execRows.length === 2, 'Expected two execution rows');
  for (const row of execRows) {
    assert(String(row.task_id || '') === task.task_id, 'Execution-task linkage missing in durable store');
  }

  console.log(JSON.stringify({
    status: 'pass',
    task_id: task.task_id,
    session_id: sessionId,
    first_execution_id: exec1.execution_id,
    last_execution_id: exec2.execution_id,
    task_state: String(taskRow.current_state || ''),
    task_event_count: states.length,
    execution_states: {
      [exec1.execution_id]: String(liveExec1.current_state || ''),
      [exec2.execution_id]: String(liveExec2.current_state || ''),
    },
    verified_persistence: true,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
NODE

