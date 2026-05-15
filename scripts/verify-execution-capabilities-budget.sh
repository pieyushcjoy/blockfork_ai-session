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
require_cmd rg

echo "[1/5] Waiting for runtime listener"
wait_for_listener

echo "[2/5] Creating isolated non-stream session"
NONSTREAM_SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
NONSTREAM_LIVE_KEY="$(printf '%s' "$NONSTREAM_SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
NONSTREAM_SESSION_ID="$(printf '%s' "$NONSTREAM_SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"

if [[ -z "$NONSTREAM_LIVE_KEY" || -z "$NONSTREAM_SESSION_ID" ]]; then
  echo "Failed to create non-stream verification session" >&2
  exit 1
fi

echo "[3/5] Sending non-stream and stream requests"
NONCE="exec-cap-budget-$(date +%s)-$$"
curl -fsS -X POST "$BASE_URL/v1/chat/completions" \
  -H "authorization: Bearer $NONSTREAM_LIVE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"managed\",\"messages\":[{\"role\":\"user\",\"content\":\"$NONCE nonstream\"}],\"max_tokens\":8}" \
  | rg -q '"object"\s*:\s*"chat\.completion"'

STREAM_SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
STREAM_LIVE_KEY="$(printf '%s' "$STREAM_SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
STREAM_SESSION_ID="$(printf '%s' "$STREAM_SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"
BUDGET_SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
BUDGET_LIVE_KEY="$(printf '%s' "$BUDGET_SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
BUDGET_SESSION_ID="$(printf '%s' "$BUDGET_SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.session_id||j.session?.session_id||"")})')"

if [[ -z "$STREAM_LIVE_KEY" || -z "$STREAM_SESSION_ID" || -z "$BUDGET_LIVE_KEY" || -z "$BUDGET_SESSION_ID" ]]; then
  echo "Failed to create additional verification sessions" >&2
  exit 1
fi

STREAM_OUTPUT="$(curl -fsS -N -X POST "$BASE_URL/v1/chat/completions" \
  -H "authorization: Bearer $STREAM_LIVE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"managed\",\"messages\":[{\"role\":\"user\",\"content\":\"$NONCE stream\"}],\"max_tokens\":8,\"stream\":true}")"
printf '%s' "$STREAM_OUTPUT" | rg -q '^data: '

echo "[4/5] Verifying capability and budget persistence, fallback updates, deterministic budget rejection, and conservative stale-fact handling"
node - "$REPO_ROOT" "$DB_PATH" "$NONSTREAM_SESSION_ID" "$STREAM_SESSION_ID" "$BUDGET_SESSION_ID" "$NONSTREAM_LIVE_KEY" "$STREAM_LIVE_KEY" "$BUDGET_LIVE_KEY" <<'NODE'
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.join(process.argv[2], 'node_modules', 'sql.js'));
const runtime = require(path.join(process.argv[2], 'server.js'));

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

function latestExecutionIdForSession(db, sessionId) {
  const stmt = db.prepare(`
    SELECT execution_id
    FROM executions
    WHERE session_id = ?
    ORDER BY rowid DESC
    LIMIT 1
  `);
  stmt.bind([sessionId]);
  if (!stmt.step()) {
    throw new Error(`No execution found for session ${sessionId}`);
  }
  const row = stmt.getAsObject();
  stmt.free();
  return String(row.execution_id || '');
}

(async () => {
  const dbPath = process.argv[3];
  const nonstreamSessionId = process.argv[4];
  const streamSessionId = process.argv[5];
  const budgetSessionId = process.argv[6];
  const nonstreamLiveKey = process.argv[7];
  const streamLiveKey = process.argv[8];
  const budgetLiveKey = process.argv[9];
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const nonstreamResolved = await runtime.resolveLiveKeySession(nonstreamLiveKey);
  const streamResolved = await runtime.resolveLiveKeySession(streamLiveKey);
  const budgetResolved = await runtime.resolveLiveKeySession(budgetLiveKey);
  assert(nonstreamResolved.session, 'Failed to resolve non-stream verification session');
  assert(streamResolved.session, 'Failed to resolve stream verification session');
  assert(budgetResolved.session, 'Failed to resolve budget verification session');

  const nonstreamExecutionId = latestExecutionIdForSession(db, nonstreamSessionId);
  const streamExecutionId = latestExecutionIdForSession(db, streamSessionId);

  const nonstreamCapability = await runtime.getExecutionCapabilityRecord(nonstreamExecutionId);
  const nonstreamBudget = await runtime.getExecutionBudgetRecord(nonstreamExecutionId);
  const streamBudget = await runtime.getExecutionBudgetRecord(streamExecutionId);
  assert(nonstreamCapability, 'Primary execution missing capability record');
  assert(nonstreamBudget, 'Primary execution missing budget record');
  assert(streamBudget, 'Stream execution missing budget record');

  const expectedPrimaryProviderClass = runtime.MODEL_MAP.managed.providerId === 'local_openai' ? 'local' : 'remote';
  assert(nonstreamCapability.provider_class === expectedPrimaryProviderClass, `Primary provider_class mismatch: ${nonstreamCapability.provider_class}`);
  assert(nonstreamBudget.completed_input_tokens >= 0, 'Non-stream completed_input_tokens missing');
  assert(nonstreamBudget.completed_output_tokens >= 0, 'Non-stream completed_output_tokens missing');
  assert(streamBudget.completed_input_tokens >= 0, 'Stream completed_input_tokens missing');
  assert(streamBudget.completed_output_tokens >= 0, 'Stream completed_output_tokens missing');

  const syntheticExecution = await runtime.createExecutionRecord({
    sessionId: nonstreamSessionId,
    requestId: `verify-capability-fallback-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_capability_fallback_created',
  });
  const primaryDescriptor = runtime.getModelDescriptor('managed');
  const remoteDescriptor = runtime.getModelDescriptor('openai/gpt-4o-mini');
  assert(primaryDescriptor, 'Primary descriptor unavailable');
  assert(remoteDescriptor, 'Remote descriptor unavailable');
  const syntheticSession = nonstreamResolved.session;
  const capabilitySeed = runtime.buildExecutionCapabilityRecord(
    syntheticExecution.execution.execution_id,
    syntheticSession,
    'managed',
    primaryDescriptor,
    remoteDescriptor,
    { timestamp: new Date().toISOString() }
  );
  await runtime.persistExecutionCapabilityRecord(capabilitySeed);
  await runtime.updateExecutionCapabilityFallbackUse(syntheticExecution.execution.execution_id, remoteDescriptor, {
    timestamp: new Date().toISOString(),
    timeoutProfile: 'remote_fallback',
  });
  const fallbackCapability = await runtime.getExecutionCapabilityRecord(syntheticExecution.execution.execution_id);
  assert(fallbackCapability.fallback_used === 1, 'Fallback capability record did not mark fallback_used');
  assert(fallbackCapability.provider_class === 'remote', `Fallback provider class mismatch: ${fallbackCapability.provider_class}`);
  assert(fallbackCapability.timeout_profile === 'remote_fallback', `Fallback timeout profile mismatch: ${fallbackCapability.timeout_profile}`);

  const directSession = nonstreamResolved.session;
  const directDescriptor = runtime.getModelDescriptor(directSession.default_model_alias);
  const overContextBody = {
    model: directSession.default_model_alias,
    messages: [{ role: 'user', content: 'x'.repeat((Number(directDescriptor.contextWindow || 0) * 4) + 8192) }],
    max_tokens: 32,
  };
  const overContextResult = await runtime.executeChatFlow(directSession, overContextBody, {
    route: 'chat/completions',
  });
  assert(overContextResult.error?.code === 'context_window_exceeded', `Expected context_window_exceeded, saw ${overContextResult.error?.code || 'none'}`);
  const overContextBudget = await runtime.getExecutionBudgetRecord(overContextResult.billing.execution_id);
  assert(overContextBudget?.budget_rejection_reason === 'context_window_exceeded', `Over-context budget reason mismatch: ${overContextBudget?.budget_rejection_reason || 'none'}`);

  const overMaxOutputBody = {
    model: directSession.default_model_alias,
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: Number(directDescriptor.maxTokens || 0) + 1,
  };
  const overMaxOutputResult = await runtime.executeChatFlow(directSession, overMaxOutputBody, {
    route: 'chat/completions',
  });
  assert(overMaxOutputResult.error?.code === 'reserved_output_exceeded', `Expected reserved_output_exceeded, saw ${overMaxOutputResult.error?.code || 'none'}`);
  const overMaxBudget = await runtime.getExecutionBudgetRecord(overMaxOutputResult.billing.execution_id);
  assert(overMaxBudget?.budget_rejection_reason === 'reserved_output_exceeded', `Over-max budget reason mismatch: ${overMaxBudget?.budget_rejection_reason || 'none'}`);

  const budgetSession = budgetResolved.session;
  budgetSession.session_budget_usd = 0;
  budgetSession.session_spend_usd = 0;
  budgetSession.session_reserved_usd = 0;
  await runtime.registerSessionState(budgetSession);
  const budgetRejectResult = await runtime.executeChatFlow(budgetSession, {
    model: budgetSession.default_model_alias,
    messages: [{ role: 'user', content: 'budget gate check' }],
    max_tokens: 8,
  }, {
    route: 'chat/completions',
  });
  assert(budgetRejectResult.error?.code === 'session_budget_exceeded', `Expected session_budget_exceeded, saw ${budgetRejectResult.error?.code || 'none'}`);
  const budgetRejectRow = await runtime.getExecutionBudgetRecord(budgetRejectResult.billing.execution_id);
  assert(budgetRejectRow?.budget_rejection_reason === 'session_budget_exceeded', `Session budget rejection mismatch: ${budgetRejectRow?.budget_rejection_reason || 'none'}`);

  const staleExecution = await runtime.createExecutionRecord({
    sessionId: nonstreamSessionId,
    requestId: `verify-capability-stale-${Date.now()}`,
    actorSource: 'verification',
    reasonCode: 'verify_capability_stale_created',
  });
  const staleCapability = runtime.buildExecutionCapabilityRecord(
    staleExecution.execution.execution_id,
    syntheticSession,
    'managed',
    primaryDescriptor,
    remoteDescriptor,
    { timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString() }
  );
  staleCapability.retryability_class = 'safe_retryable';
  staleCapability.validated_at = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  staleCapability.expires_at = new Date(Date.now() - 60 * 1000).toISOString();
  await runtime.persistExecutionCapabilityRecord(staleCapability);
  const retryEligibility = await runtime.canExecutionUseOptimisticRetry(staleExecution.execution.execution_id);
  assert(retryEligibility.allowed === false, 'Stale capability facts unexpectedly allowed optimistic retry');

  console.log(JSON.stringify({
    nonstream_execution_id: nonstreamExecutionId,
    stream_execution_id: streamExecutionId,
    over_context_execution_id: overContextResult.billing.execution_id,
    over_max_output_execution_id: overMaxOutputResult.billing.execution_id,
    budget_reject_execution_id: budgetRejectResult.billing.execution_id,
  }));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE

echo "[5/5] Capability and budget verification PASS"
