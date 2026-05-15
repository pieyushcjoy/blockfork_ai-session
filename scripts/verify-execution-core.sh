#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
ENV_FILE="${ENV_FILE:-.env}"
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

echo "[1/6] Waiting for runtime listener"
wait_for_listener

echo "[2/6] Creating isolated session"
SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
LIVE_KEY="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
SESSION_ID="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"

if [[ -z "$LIVE_KEY" || -z "$SESSION_ID" ]]; then
  echo "Failed to create isolated session for execution verification" >&2
  exit 1
fi

echo "[3/6] Sending canonical chat request"
NONCE="exec-core-$(date +%s)-$$"
CHAT_JSON="$(curl -fsS -X POST "$BASE_URL/v1/chat/completions" \
  -H "authorization: Bearer $LIVE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"managed\",\"messages\":[{\"role\":\"user\",\"content\":\"$NONCE\"}],\"max_tokens\":8}")"
printf '%s' "$CHAT_JSON" | rg -q '"object"\s*:\s*"chat\.completion"'

echo "[4/6] Validating durable execution record + request correlation"
CORE_REPORT="$(node - "$REPO_ROOT" "$DB_PATH" "$SESSION_ID" <<'NODE'
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));

(async () => {
  const dbPath = process.argv[3];
  const sessionId = process.argv[4];
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const execStmt = db.prepare(`
    SELECT execution_id, current_state, created_at, updated_at, last_request_id
    FROM executions
    WHERE session_id = ?
    ORDER BY rowid DESC
    LIMIT 1
  `);
  execStmt.bind([sessionId]);
  if (!execStmt.step()) {
    throw new Error('No execution row found for isolated session');
  }
  const execRow = execStmt.getAsObject();
  execStmt.free();

  const logStmt = db.prepare(`
    SELECT request_id, execution_id, route, status
    FROM request_logs
    WHERE execution_id = ?
    ORDER BY rowid DESC
    LIMIT 1
  `);
  logStmt.bind([String(execRow.execution_id || '')]);
  if (!logStmt.step()) {
    throw new Error('No request_logs row linked to execution');
  }
  const logRow = logStmt.getAsObject();
  logStmt.free();

  const eventStmt = db.prepare(`
    SELECT previous_state, new_state, reason_code
    FROM execution_events
    WHERE execution_id = ?
    ORDER BY rowid ASC
  `);
  eventStmt.bind([String(execRow.execution_id || '')]);
  const events = [];
  while (eventStmt.step()) {
    const row = eventStmt.getAsObject();
    events.push({
      previous_state: String(row.previous_state || ''),
      new_state: String(row.new_state || ''),
      reason_code: String(row.reason_code || ''),
    });
  }
  eventStmt.free();

  const createdIdx = events.findIndex((event) => event.new_state === 'created');
  const queuedIdx = events.findIndex((event) => event.previous_state === 'created' && event.new_state === 'queued');
  const runningIdx = events.findIndex((event) => event.previous_state === 'queued' && event.new_state === 'running');

  if (createdIdx === -1 || queuedIdx === -1 || runningIdx === -1) {
    throw new Error(`Admission path missing expected events: ${JSON.stringify(events)}`);
  }
  if (!(createdIdx < queuedIdx && queuedIdx < runningIdx)) {
    throw new Error(`Admission ordering invalid: ${JSON.stringify(events)}`);
  }
  if (!String(logRow.execution_id || '')) {
    throw new Error('request_logs.execution_id is empty');
  }

  console.log(JSON.stringify({
    execution_id: String(execRow.execution_id || ''),
    current_state: String(execRow.current_state || ''),
    request_id: String(logRow.request_id || ''),
    request_status: String(logRow.status || ''),
    event_count: events.length,
  }));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE
)"
printf '%s\n' "$CORE_REPORT"

EXECUTION_ID="$(printf '%s' "$CORE_REPORT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.execution_id||"")})')"
if [[ -z "$EXECUTION_ID" ]]; then
  echo "Execution core report did not return an execution_id" >&2
  exit 1
fi

echo "[5/6] Restarting runtime to confirm restart durability"
ENV_FILE="$ENV_FILE" bash "$REPO_ROOT/scripts/runtime-ctl.sh" restart >/dev/null
wait_for_listener

echo "[6/6] Re-checking durable execution after restart"
node - "$REPO_ROOT" "$DB_PATH" "$SESSION_ID" "$EXECUTION_ID" <<'NODE'
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));

(async () => {
  const dbPath = process.argv[3];
  const sessionId = process.argv[4];
  const executionId = process.argv[5];
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const stmt = db.prepare(`
    SELECT execution_id, session_id, current_state
    FROM executions
    WHERE execution_id = ? AND session_id = ?
    LIMIT 1
  `);
  stmt.bind([executionId, sessionId]);
  if (!stmt.step()) {
    throw new Error('Execution record missing after restart');
  }
  const row = stmt.getAsObject();
  stmt.free();

  const logStmt = db.prepare(`
    SELECT request_id, execution_id
    FROM request_logs
    WHERE execution_id = ?
    LIMIT 1
  `);
  logStmt.bind([executionId]);
  if (!logStmt.step()) {
    throw new Error('Request correlation missing after restart');
  }
  logStmt.free();

  console.log(`Execution durable after restart: ${String(row.execution_id || '')} (${String(row.current_state || '')})`);
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE

echo "Execution core verification PASS"
