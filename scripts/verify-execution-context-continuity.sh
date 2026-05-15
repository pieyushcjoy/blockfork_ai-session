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

echo "[1/4] Waiting for runtime listener"
wait_for_listener

echo "[2/4] Creating isolated verification sessions"
SESSION_A_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"

SESSION_A_ID="$(printf '%s' "$SESSION_A_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"
SESSION_A_KEY="$(printf '%s' "$SESSION_A_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
if [[ -z "$SESSION_A_ID" || -z "$SESSION_A_KEY" ]]; then
  echo "Failed to create verification sessions" >&2
  exit 1
fi

echo "[3/4] Executing continuity verification checks"
node - "$REPO_ROOT" "$DB_PATH" "$SESSION_A_ID" "$SESSION_A_KEY" <<'NODE'
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));
const runtime = require(path.join(process.argv[2], 'server.js'));

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function scalar(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const ok = stmt.step();
  const row = ok ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function getLatestExecutionForSession(db, sessionId) {
  const row = scalar(db, `
    SELECT execution_id, current_state
    FROM executions
    WHERE session_id = ?
    ORDER BY rowid DESC
    LIMIT 1
  `, [sessionId]);
  assert(row?.execution_id, `No execution for session ${sessionId}`);
  return row;
}

function getEventsForExecution(db, executionId) {
  const stmt = db.prepare(`
    SELECT new_state, reason_code
    FROM execution_events
    WHERE execution_id = ?
    ORDER BY rowid ASC
  `);
  stmt.bind([executionId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

(async () => {
  const repoRoot = process.argv[2];
  const dbPath = process.argv[3];
  const sessionAId = process.argv[4];
  const sessionAKey = process.argv[5];

  const SQL = await initSqlJs();
  let db = new SQL.Database(fs.readFileSync(dbPath));

  const resolved = await runtime.resolveLiveKeySession(sessionAKey);
  assert(resolved.session, 'Failed to resolve primary session');
  const session = resolved.session;
  const descriptor = runtime.getModelDescriptor(session.default_model_alias);
  assert(descriptor, 'Missing model descriptor');
  const cw = Number(descriptor.contextWindow || 0);
  const mt = Number(descriptor.maxTokens || 0);
  assert(cw > 0 && mt > 0, 'Descriptor missing context window or max tokens');

  const mkBody = (chars, maxTokens) => ({
    model: session.default_model_alias,
    messages: [{ role: 'user', content: 'x'.repeat(chars) }],
    max_tokens: maxTokens
  });

  // healthy
  let res = await runtime.executeChatFlow(session, mkBody(64, 8), { route: 'chat/completions' });
  assert(res.billing?.execution_id, 'Healthy execution missing execution_id');

  // warning
  const warningChars = Math.floor((cw * 0.72) / 4);
  res = await runtime.executeChatFlow(session, mkBody(warningChars, 16), { route: 'chat/completions' });
  assert(res.billing?.execution_id, 'Warning execution missing execution_id');

  // critical
  const criticalChars = Math.floor((cw * 0.90) / 4);
  res = await runtime.executeChatFlow(session, mkBody(criticalChars, 16), { route: 'chat/completions' });
  assert(res.billing?.execution_id, 'Critical execution missing execution_id');

  // over-limit deterministic rejection
  const over = await runtime.executeChatFlow(session, {
    model: session.default_model_alias,
    messages: [{ role: 'user', content: 'bounded request' }],
    max_tokens: mt + 128,
  }, { route: 'chat/completions' });
  assert(over.error?.code === 'reserved_output_exceeded', `Expected reserved_output_exceeded, saw ${over.error?.code || 'none'}`);
  assert(over.billing?.execution_id, 'Over-limit execution missing execution_id');

  const overExec = over.billing.execution_id;
  const overBudget = await runtime.getExecutionBudgetRecord(overExec);
  assert(overBudget?.budget_rejection_reason === 'reserved_output_exceeded', `Over-limit budget reason mismatch: ${overBudget?.budget_rejection_reason || 'none'}`);
  const overCap = await runtime.getExecutionCapabilityRecord(overExec);
  assert(Number(overCap?.fallback_used || 0) === 0, 'Over-limit unexpectedly used fallback');
  const overEvents = getEventsForExecution(db, overExec);
  assert(!overEvents.some((e) => String(e.new_state) === 'retrying'), 'Over-limit path unexpectedly entered retrying state');

  // continuity ledger checks
  db.close();
  db = new SQL.Database(fs.readFileSync(dbPath));

  const overLimitEvent = scalar(db, `
    SELECT event_id, decision, execution_id FROM session_continuity_events
    WHERE session_id = ? AND event_type = 'pressure_over_limit'
    ORDER BY rowid DESC LIMIT 1
  `, [sessionAId]);
  assert(overLimitEvent?.event_id, 'Missing pressure_over_limit continuity event');
  assert(String(overLimitEvent.decision) === 'reject_over_limit', `Unexpected over-limit decision: ${overLimitEvent.decision}`);

  const pressureSnapshot = scalar(db, `
    SELECT latest_pressure_state, latest_execution_id
    FROM session_context_pressure
    WHERE session_id = ?
  `, [sessionAId]);
  assert(pressureSnapshot?.latest_pressure_state, 'Missing session_context_pressure snapshot');
  assert(pressureSnapshot?.latest_execution_id, 'Missing latest_execution_id in session_context_pressure');

  // restart durability check for continuity rows
  db.close();
  const reopened = new SQL.Database(fs.readFileSync(dbPath));
  const persisted = scalar(reopened, `
    SELECT event_id
    FROM session_continuity_events
    WHERE session_id = ?
    ORDER BY rowid DESC LIMIT 1
  `, [sessionAId]);
  assert(persisted?.event_id, 'Continuity events not durable after DB reopen');
  reopened.close();

  console.log('Context continuity verification passed');
})();
NODE

echo "[4/4] Context continuity verification passed"
