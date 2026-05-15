#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

wait_for_listener() {
  local start_time now
  start_time="$(date +%s)"
  while true; do
    if lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    now="$(date +%s)"
    if (( now - start_time >= STARTUP_TIMEOUT_SECONDS )); then
      echo "Runtime not listening on 127.0.0.1:3100 after ${STARTUP_TIMEOUT_SECONDS}s" >&2
      exit 1
    fi
    sleep 1
  done
}

require_cmd curl
require_cmd node
require_cmd lsof

echo "[1/5] Waiting for runtime listener"
wait_for_listener

echo "[2/5] Creating isolated session"
SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
LIVE_KEY="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
SESSION_ID="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"

if [[ -z "$LIVE_KEY" || -z "$SESSION_ID" ]]; then
  echo "Failed to create isolated session for transition verification" >&2
  exit 1
fi

echo "[3/5] Creating one successful execution and one deterministic failed execution"
SUCCESS_NONCE="exec-transition-success-$(date +%s)-$$"

SUCCESS_JSON="$(curl -fsS -X POST "$BASE_URL/v1/chat/completions" \
  -H "authorization: Bearer $LIVE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"managed\",\"messages\":[{\"role\":\"user\",\"content\":\"$SUCCESS_NONCE\"}],\"max_tokens\":8}")"
printf '%s' "$SUCCESS_JSON" | rg -q '"object"\s*:\s*"chat\.completion"'

FAILED_EXECUTION_ID="$(node - "$REPO_ROOT" "$SESSION_ID" <<'NODE'
const path = require('path');
const runtime = require(path.join(process.argv[2], 'server.js'));
const sessionId = process.argv[3];

(async () => {
  const created = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-failed-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_failed_created',
  });
  await runtime.transitionExecution(created.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_failed_queued',
  });
  await runtime.transitionExecution(created.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_failed_running',
  });
  await runtime.transitionExecution(created.execution.execution_id, runtime.EXECUTION_STATES.FAILED, {
    actorSource: 'verification',
    reasonCode: 'verify_failed_terminal',
  });
  process.stdout.write(created.execution.execution_id);
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE
)"
if [[ -z "$FAILED_EXECUTION_ID" ]]; then
  echo "Failed to create deterministic failed execution" >&2
  exit 1
fi

echo "[4/5] Verifying legal transition paths in sqlite"
TRANSITION_REPORT="$(node - "$REPO_ROOT" "$DB_PATH" "$SESSION_ID" <<'NODE'
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));

function eventPathFor(db, executionId) {
  const stmt = db.prepare(`
    SELECT previous_state, new_state
    FROM execution_events
    WHERE execution_id = ?
    ORDER BY rowid ASC
  `);
  stmt.bind([executionId]);
  const parts = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const prev = String(row.previous_state || '');
    const next = String(row.new_state || '');
    parts.push(prev ? `${prev}->${next}` : next);
  }
  stmt.free();
  return parts;
}

(async () => {
  const dbPath = process.argv[3];
  const sessionId = process.argv[4];
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const stmt = db.prepare(`
    SELECT execution_id, current_state
    FROM executions
    WHERE session_id = ?
    ORDER BY rowid DESC
    LIMIT 2
  `);
  stmt.bind([sessionId]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  if (rows.length < 2) {
    throw new Error('Expected at least two execution rows for transition verification');
  }

  const report = rows.map((row) => ({
    execution_id: String(row.execution_id || ''),
    current_state: String(row.current_state || ''),
    path: eventPathFor(db, String(row.execution_id || '')),
  }));

  const success = report.find((item) => item.current_state === 'completed');
  const failure = report.find((item) => item.current_state === 'failed');

  if (!success) {
    throw new Error(`No completed execution found: ${JSON.stringify(report)}`);
  }
  if (!failure) {
    throw new Error(`No failed execution found: ${JSON.stringify(report)}`);
  }

  const successNeedle = ['created', 'created->queued', 'queued->running', 'running->completed'];
  const failureNeedle = ['created', 'created->queued', 'queued->running', 'running->failed'];

  for (const needle of successNeedle) {
    if (!success.path.includes(needle)) {
      throw new Error(`Completed execution missing transition ${needle}: ${JSON.stringify(success)}`);
    }
  }
  for (const needle of failureNeedle) {
    if (!failure.path.includes(needle)) {
      throw new Error(`Failed execution missing transition ${needle}: ${JSON.stringify(failure)}`);
    }
  }

  console.log(JSON.stringify({ success, failure }));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE
)"
printf '%s\n' "$TRANSITION_REPORT"

echo "[5/5] Verifying illegal transitions are rejected"
node - "$REPO_ROOT" "$SESSION_ID" "$TRANSITION_REPORT" <<'NODE'
const path = require('path');
const runtime = require(path.join(process.argv[2], 'server.js'));
const sessionId = process.argv[3];
const report = JSON.parse(process.argv[4]);

async function expectReject(label, fn) {
  try {
    await fn();
  } catch (error) {
    process.stdout.write(`Rejected as expected: ${label}\n`);
    return;
  }
  throw new Error(`Expected rejection for ${label}`);
}

(async () => {
  await expectReject('completed -> running', () => runtime.transitionExecution(report.success.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'illegal_reopen_completed',
  }));

  await expectReject('failed -> completed', () => runtime.transitionExecution(report.failure.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    actorSource: 'verification',
    reasonCode: 'illegal_complete_failed',
  }));

  const created = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-created-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_created_execution',
  });

  await expectReject('created -> completed', () => runtime.transitionExecution(created.execution.execution_id, runtime.EXECUTION_STATES.COMPLETED, {
    actorSource: 'verification',
    reasonCode: 'illegal_shortcut_complete',
  }));

  const running = await runtime.createExecutionRecord({
    sessionId,
    requestId: `verify-running-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_running_execution',
  });
  await runtime.transitionExecution(running.execution.execution_id, runtime.EXECUTION_STATES.QUEUED, {
    actorSource: 'verification',
    reasonCode: 'verify_queue',
  });
  await runtime.transitionExecution(running.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'verify_run',
  });
  await expectReject('running -> running', () => runtime.transitionExecution(running.execution.execution_id, runtime.EXECUTION_STATES.RUNNING, {
    actorSource: 'verification',
    reasonCode: 'illegal_duplicate_running',
  }));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE

echo "Execution transition verification PASS"
