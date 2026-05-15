#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$REPO_ROOT/billing.sqlite"

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

echo "[1/4] Waiting for runtime listener"
wait_for_listener

echo "[2/4] Creating isolated verification session"
SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
SESSION_ID="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"
LIVE_KEY="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
if [[ -z "$SESSION_ID" || -z "$LIVE_KEY" ]]; then
  echo "Failed to create verification session" >&2
  exit 1
fi

echo "[3/4] Verifying recommendation lifecycle"
node - "$REPO_ROOT" "$DB_PATH" "$SESSION_ID" "$LIVE_KEY" <<'NODE'
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

(async () => {
  const dbPath = process.argv[3];
  const sessionId = process.argv[4];
  const liveKey = process.argv[5];
  const SQL = await initSqlJs();
  let db = new SQL.Database(fs.readFileSync(dbPath));
  const resolved = await runtime.resolveLiveKeySession(liveKey);
  assert(resolved.session, 'Failed to resolve verification session');
  const session = resolved.session;
  const descriptor = runtime.getModelDescriptor(session.default_model_alias);
  assert(descriptor, 'Missing model descriptor');
  const cw = Number(descriptor.contextWindow || 0);
  const mt = Number(descriptor.maxTokens || 0);

  // advisory recommendation baseline
  await runtime.createOrUpdateSessionRecommendation({
    sessionId,
    recommendationType: 'monitor_pressure',
    pressureState: 'warning',
    reasonCode: 'pressure_threshold_crossed',
  });
  // repeated critical escalation target
  await runtime.createOrUpdateSessionRecommendation({
    sessionId,
    recommendationType: 'recommend_compaction_candidate',
    pressureState: 'critical',
    reasonCode: 'critical_pressure_repeated',
  });

  // over-limit deterministic pre-dispatch
  const over = await runtime.executeChatFlow(session, {
    model: session.default_model_alias,
    messages: [{ role: 'user', content: 'bounded request' }],
    max_tokens: mt + 128,
  }, { route: 'chat/completions' });
  assert(over.error?.code === 'reserved_output_exceeded', 'Expected deterministic over-limit rejection');

  db.close();
  db = new SQL.Database(fs.readFileSync(dbPath));

  const active = scalar(db, `
    SELECT recommendation_type, status
    FROM session_continuity_recommendations
    WHERE session_id = ? AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `, [sessionId]);
  assert(active?.recommendation_type, 'Missing active recommendation');
  assert(String(active.recommendation_type) === 'require_manual_reset', `Expected require_manual_reset active recommendation, saw ${active?.recommendation_type}`);

  const compaction = scalar(db, `
    SELECT recommendation_id
    FROM session_continuity_recommendations
    WHERE session_id = ? AND recommendation_type = 'recommend_compaction_candidate'
    ORDER BY created_at DESC
    LIMIT 1
  `, [sessionId]);
  assert(compaction?.recommendation_id, 'Missing recommend_compaction_candidate recommendation');

  const superseded = scalar(db, `
    SELECT COUNT(*) AS count
    FROM session_continuity_recommendations
    WHERE session_id = ? AND status = 'superseded'
  `, [sessionId]);
  assert(Number(superseded?.count || 0) >= 1, 'Expected superseded recommendations');

  // fresh session lineage should resolve reset/rollover recommendations
  const s1 = `session-lineage-root-${Date.now()}`;
  const s2 = `session-lineage-child-${Date.now()}`;
  await runtime.createOrUpdateSessionRecommendation({
    sessionId: s1,
    recommendationType: 'recommend_rollover',
    pressureState: 'critical',
    reasonCode: 'downstream_context_overflow',
  });
  await runtime.resolveRecommendationFromLineage(s1, s2);

  db.close();
  db = new SQL.Database(fs.readFileSync(dbPath));
  const resolvedRow = scalar(db, `
    SELECT status, resolution_reason
    FROM session_continuity_recommendations
    WHERE session_id = ? AND recommendation_type = 'recommend_rollover'
    ORDER BY created_at DESC
    LIMIT 1
  `, [s1]);
  assert(String(resolvedRow?.status || '') === 'resolved', `Expected resolved recommendation, saw ${resolvedRow?.status}`);
  assert(String(resolvedRow?.resolution_reason || '') === 'resolved_by_fresh_session_lineage', 'Unexpected resolution reason');

  db.close();
  const reopened = new SQL.Database(fs.readFileSync(dbPath));
  const durable = scalar(reopened, `
    SELECT recommendation_id
    FROM session_continuity_recommendations
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `, [sessionId]);
  assert(durable?.recommendation_id, 'Recommendation durability check failed');
  reopened.close();

  console.log('Continuity recommendation verification passed');
})();
NODE

echo "[4/4] Continuity recommendation verification passed"
