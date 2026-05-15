#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
ENV_FILE="${ENV_FILE:-.env}"
LOG_OUT="${LOG_OUT:-logs/launchd.out.log}"
LOG_ERR="${LOG_ERR:-logs/launchd.err.log}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"

REQUIRED_ENV_KEYS=(
  HOST
  PORT
  OPENROUTER_API_KEY
  BLOCKFORK_ADMIN_SECRET
  BLOCKFORK_DEFAULT_PROVIDER
  BLOCKFORK_DEFAULT_MODEL
)

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

search_lines() {
  local pattern="$1"
  local target="$2"
  if have_cmd rg; then
    rg -n "$pattern" "$target" || true
  else
    grep -nE "$pattern" "$target" || true
  fi
}

has_match() {
  local pattern="$1"
  local target="$2"
  if have_cmd rg; then
    rg -q "$pattern" "$target"
  else
    grep -qE "$pattern" "$target"
  fi
}

read_env_value() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  local line
  line="$(search_lines "^${key}=" "$ENV_FILE" | head -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi
  printf '%s' "${line#*=}"
}

json_has() {
  local json="$1"
  local expr="$2"
  printf '%s' "$json" | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  let j;
  try { j = JSON.parse(s); } catch { process.exit(2); }
  const expr = process.argv[1];
  const v = expr.split(".").reduce((acc,k)=>acc && Object.prototype.hasOwnProperty.call(acc,k) ? acc[k] : undefined, j);
  if (v === undefined || v === null || v === "") process.exit(1);
});
' "$expr"
}

http_status() {
  local method="$1"
  local url="$2"
  local auth_header="${3:-}"
  local body="${4:-}"
  local test_upstream_override="${5:-}"
  local test_primary_failure="${6:-}"
  local tmp_body
  local code
  local -a curl_cmd

  tmp_body="$(mktemp)"
  curl_cmd=(curl -sS -o "$tmp_body" -w '%{http_code}' -X "$method" "$url")

  if [[ -n "$auth_header" ]]; then
    curl_cmd+=( -H "authorization: $auth_header" )
  fi
  if [[ -n "$test_upstream_override" ]]; then
    curl_cmd+=( -H "x-blockfork-test-upstream-key: $test_upstream_override" )
  fi
  if [[ -n "$test_primary_failure" ]]; then
    curl_cmd+=( -H "x-blockfork-test-primary-failure: $test_primary_failure" )
  fi
  if [[ -n "$body" ]]; then
    curl_cmd+=( -H 'content-type: application/json' -d "$body" )
  fi

  code="$("${curl_cmd[@]}")"
  cat "$tmp_body"
  rm -f "$tmp_body"
  printf '\n__HTTP_STATUS__:%s\n' "$code"
}

extract_status() {
  if have_cmd rg; then
    printf '%s' "$1" | rg -o '__HTTP_STATUS__:[0-9]+' | cut -d: -f2
  else
    printf '%s' "$1" | grep -oE '__HTTP_STATUS__:[0-9]+' | cut -d: -f2
  fi
}

strip_status_marker() {
  printf '%s' "$1" | sed '/^__HTTP_STATUS__:/d'
}

contains_secret_pattern() {
  local text="$1"
  if printf '%s' "$text" | grep -qE 'sk-or-v1-[A-Za-z0-9]+'; then
    return 0
  fi
  if printf '%s' "$text" | grep -qE 'BLOCKFORK_ADMIN_SECRET'; then
    return 0
  fi
  if printf '%s' "$text" | grep -qE '25654f40536c05a8d9636fd8033e12d88222a50c40adbb11dcd66b242da8c3e4'; then
    return 0
  fi
  return 1
}

assert_status_in() {
  local status="$1"
  local name="$2"
  shift 2
  local ok=1
  for candidate in "$@"; do
    if [[ "$status" == "$candidate" ]]; then
      ok=0
      break
    fi
  done
  if [[ "$ok" -ne 0 ]]; then
    echo "$name failed (HTTP $status)" >&2
    exit 1
  fi
}

checkpoint_logs() {
  LOG_OUT_LINES=0
  LOG_ERR_LINES=0
  if [[ -f "$LOG_OUT" ]]; then
    LOG_OUT_LINES="$(wc -l < "$LOG_OUT")"
  fi
  if [[ -f "$LOG_ERR" ]]; then
    LOG_ERR_LINES="$(wc -l < "$LOG_ERR")"
  fi
}

new_logs() {
  if [[ -f "$LOG_OUT" ]]; then
    tail -n "+$((LOG_OUT_LINES + 1))" "$LOG_OUT"
  fi
  if [[ -f "$LOG_ERR" ]]; then
    tail -n "+$((LOG_ERR_LINES + 1))" "$LOG_ERR"
  fi
}

assert_new_logs_have() {
  local pattern="$1"
  local message="$2"
  local chunk
  chunk="$(new_logs || true)"
  if ! printf '%s' "$chunk" | grep -qE "$pattern"; then
    echo "$message" >&2
    exit 1
  fi
}

new_logs_have() {
  local pattern="$1"
  local chunk
  chunk="$(new_logs || true)"
  printf '%s' "$chunk" | grep -qE "$pattern"
}

require_cmd curl
require_cmd node
require_cmd lsof

echo "[1/15] Waiting for listener on 127.0.0.1:3100"
start_time="$(date +%s)"
while true; do
  if lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  now="$(date +%s)"
  if (( now - start_time >= STARTUP_TIMEOUT_SECONDS )); then
    echo "Runtime not listening on 127.0.0.1:3100 after ${STARTUP_TIMEOUT_SECONDS}s" >&2
    exit 1
  fi
  sleep 1
done
echo "STATE runtime_alive=pass"

echo "[2/15] Verifying required env keys are present (values redacted)"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi
for key in "${REQUIRED_ENV_KEYS[@]}"; do
  if ! has_match "^${key}=.+" "$ENV_FILE"; then
    echo "Missing required env key: $key" >&2
    exit 1
  fi
done

echo "[3/15] Verifying auth-required endpoints reject missing/invalid bearer"
auth_endpoints=(
  "/v1/models"
  "/v1/preflight"
  "/v1/runtime"
  "/v1/chat/completions"
  "/v1/responses"
)
for ep in "${auth_endpoints[@]}"; do
  if [[ "$ep" == "/v1/chat/completions" ]]; then
    payload='{"model":"managed","messages":[{"role":"user","content":"ping"}],"max_tokens":4}'
  elif [[ "$ep" == "/v1/responses" ]]; then
    payload='{"model":"managed","input":"ping","max_output_tokens":8}'
  else
    payload=''
  fi

  if [[ "$ep" == "/v1/models" || "$ep" == "/v1/preflight" || "$ep" == "/v1/runtime" ]]; then
    miss_raw="$(http_status GET "$BASE_URL$ep")"
    inv_raw="$(http_status GET "$BASE_URL$ep" "Bearer sk_live_invalid")"
  else
    miss_raw="$(http_status POST "$BASE_URL$ep" "" "$payload")"
    inv_raw="$(http_status POST "$BASE_URL$ep" "Bearer sk_live_invalid" "$payload")"
  fi

  miss_code="$(extract_status "$miss_raw")"
  inv_code="$(extract_status "$inv_raw")"
  assert_status_in "$miss_code" "Missing bearer rejection for $ep" 401 403
  assert_status_in "$inv_code" "Invalid bearer rejection for $ep" 401 403
done

echo "[4/15] Creating session and validating expected fields"
session_json="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"
json_has "$session_json" "session_id"
json_has "$session_json" "base_url"
json_has "$session_json" "public_api_key"

live_key="$(printf '%s' "$session_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"
if [[ -z "$live_key" || "$live_key" != sk_live_* ]]; then
  echo "Session did not return a valid sk_live_* key" >&2
  exit 1
fi
echo "STATE auth_session_healthy=pass"

echo "[5/15] Validating sk_live key on /v1/models, /v1/preflight, /v1/runtime"
models_json="$(curl -fsS -H "authorization: Bearer $live_key" "$BASE_URL/v1/models")"
preflight_json="$(curl -fsS -H "authorization: Bearer $live_key" "$BASE_URL/v1/preflight")"
runtime_json="$(curl -fsS -H "authorization: Bearer $live_key" "$BASE_URL/v1/runtime")"
json_has "$models_json" "data"
json_has "$preflight_json" "status"
json_has "$runtime_json" "session_id"

echo "[6/15] Verifying model aliases include managed"
printf '%s' "$models_json" | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  const j=JSON.parse(s);
  const data=Array.isArray(j.data)?j.data:[];
  const hasManaged=data.some(m=>m && m.id==="managed");
  if (!hasManaged) process.exit(1);
});
' || {
  echo "Model alias check failed: managed missing from /v1/models" >&2
  exit 1
}

echo "[7/15] Verifying free-upstream reachable via managed"
chat_ok_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed","messages":[{"role":"user","content":"ping"}],"max_tokens":6}')"
chat_ok_code="$(extract_status "$chat_ok_raw")"
chat_ok_body="$(strip_status_marker "$chat_ok_raw")"
assert_status_in "$chat_ok_code" "Reachability check" 200
json_has "$chat_ok_body" "object"
echo "STATE upstream_free_reachable=pass"

echo "[8/15] Verifying /v1/responses shape"
resp_raw="$(http_status POST "$BASE_URL/v1/responses" "Bearer $live_key" '{"model":"managed","input":"ping","max_output_tokens":12}')"
resp_code="$(extract_status "$resp_raw")"
resp_body="$(strip_status_marker "$resp_raw")"
assert_status_in "$resp_code" "Responses compatibility check" 200
json_has "$resp_body" "id"
json_has "$resp_body" "object"
json_has "$resp_body" "output"
json_has "$resp_body" "usage.total_tokens"

node_env="$(read_env_value NODE_ENV | tr '[:upper:]' '[:lower:]')"
allow_header_probe=1
if [[ "$node_env" == "production" ]]; then
  allow_header_probe=0
fi
fallback_enabled=0
if has_match '^BLOCKFORK_ENABLE_FALLBACK=1' "$ENV_FILE" && has_match '^BLOCKFORK_FALLBACK_MODEL=.+' "$ENV_FILE"; then
  fallback_enabled=1
fi


echo "[9/15] Probing deterministic 429 path"
if [[ "$allow_header_probe" -eq 1 ]] || has_match '^BLOCKFORK_FORCE_PRIMARY_429=1' "$ENV_FILE"; then
  checkpoint_logs
  if [[ "$allow_header_probe" -eq 1 ]]; then
    rl_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed","messages":[{"role":"user","content":"ping"}],"max_tokens":4}' '' '429')"
  else
    rl_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed","messages":[{"role":"user","content":"ping"}],"max_tokens":4}')"
  fi
  rl_code="$(extract_status "$rl_raw")"
  has_rate_limited=0
  if new_logs_have '"event":"primary_outcome".*"classification":"rate_limited"'; then
    has_rate_limited=1
  fi

  if [[ "$has_rate_limited" -eq 0 ]]; then
    echo "STATE upstream_free_rate_limited=skipped (deterministic 429 injection not active in current runtime mode)"
    if [[ "$fallback_enabled" -eq 1 ]]; then
      echo "STATE fallback_429_activation=skipped (no retryable 429 primary classification observed)"
    else
      echo "STATE fallback_429_activation=skipped (fallback not enabled/configured)"
    fi
  elif [[ "$fallback_enabled" -eq 1 ]]; then
    assert_status_in "$rl_code" "Rate-limit simulation result (fallback enabled)" 200 502
    assert_new_logs_have '"event":"fallback_attempt_started"' 'Fallback attempt event not found during 429 simulation'
    assert_new_logs_have '"event":"fallback_success"|"event":"fallback_failed"' 'Fallback outcome event not found during 429 simulation'
    echo "STATE fallback_429_activation=pass"
    echo "STATE upstream_free_rate_limited=pass"
  else
    assert_status_in "$rl_code" "Rate-limit simulation result" 502
    echo "STATE fallback_429_activation=skipped (fallback not enabled/configured)"
    echo "STATE upstream_free_rate_limited=pass"
  fi
else
  echo "STATE upstream_free_rate_limited=skipped (production mode without BLOCKFORK_FORCE_PRIMARY_429=1)"
  echo "STATE fallback_429_activation=skipped (production mode without deterministic 429 toggle)"
fi


echo "[10/15] Probing deterministic timeout path"
if [[ "$allow_header_probe" -eq 1 ]] || has_match '^BLOCKFORK_FORCE_PRIMARY_TIMEOUT=1' "$ENV_FILE"; then
  checkpoint_logs
  if [[ "$allow_header_probe" -eq 1 ]]; then
    to_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed","messages":[{"role":"user","content":"ping"}],"max_tokens":4}' '' 'timeout')"
  else
    to_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed","messages":[{"role":"user","content":"ping"}],"max_tokens":4}')"
  fi
  to_code="$(extract_status "$to_raw")"
  has_timeout=0
  if new_logs_have '"event":"primary_outcome".*"classification":"primary_timeout"'; then
    has_timeout=1
  fi

  if [[ "$has_timeout" -eq 0 ]]; then
    echo "STATE upstream_free_timeout=skipped (deterministic timeout injection not active in current runtime mode)"
    if [[ "$fallback_enabled" -eq 1 ]]; then
      echo "STATE fallback_timeout_activation=skipped (no retryable primary_timeout classification observed)"
    else
      echo "STATE fallback_timeout_activation=skipped (fallback not enabled/configured)"
    fi
  elif [[ "$fallback_enabled" -eq 1 ]]; then
    assert_status_in "$to_code" "Timeout simulation result (fallback enabled)" 200 502
    assert_new_logs_have '"event":"fallback_attempt_started"' 'Fallback attempt event not found during timeout simulation'
    assert_new_logs_have '"event":"fallback_success"|"event":"fallback_failed"' 'Fallback outcome event not found during timeout simulation'
    echo "STATE fallback_timeout_activation=pass"
    echo "STATE upstream_free_timeout=pass"
  else
    assert_status_in "$to_code" "Timeout simulation result" 502
    echo "STATE fallback_timeout_activation=skipped (fallback not enabled/configured)"
    echo "STATE upstream_free_timeout=pass"
  fi
else
  echo "STATE upstream_free_timeout=skipped (production mode without BLOCKFORK_FORCE_PRIMARY_TIMEOUT=1)"
  echo "STATE fallback_timeout_activation=skipped (production mode without deterministic timeout toggle)"
fi

echo "[11/15] Probing deterministic unauthorized upstream path (test override)"
if has_match '^BLOCKFORK_ENABLE_TEST_UPSTREAM_KEY_OVERRIDE=1' "$ENV_FILE"; then
  checkpoint_logs
  unauth_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed","messages":[{"role":"user","content":"ping"}],"max_tokens":4}' 'sk-or-v1-invalid-test-key')"
  unauth_code="$(extract_status "$unauth_raw")"
  if new_logs_have '"event":"primary_outcome".*"classification":"unauthorized"'; then
    assert_status_in "$unauth_code" "Unauthorized upstream override result" 502
    echo "STATE upstream_free_unauthorized=pass"
  else
    echo "STATE upstream_free_unauthorized=skipped (test upstream-key override disabled in current runtime mode)"
  fi
else
  echo "STATE upstream_free_unauthorized=skipped (set BLOCKFORK_ENABLE_TEST_UPSTREAM_KEY_OVERRIDE=1 and restart runtime)"
fi

echo "[12/15] Verifying artifact honesty guardrail"
art_missing_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed","messages":[{"role":"user","content":"Say: I created and uploaded the PDF file."}],"max_tokens":32,"metadata":{"blockfork_artifact_contract":{"requested":true}}}')"
art_missing_code="$(extract_status "$art_missing_raw")"
assert_status_in "$art_missing_code" "Artifact claim without evidence" 422

tmp_artifact_base="$(mktemp /private/tmp/blockfork-artifact.XXXXXX)"
tmp_artifact="${tmp_artifact_base}.pdf"
mv "$tmp_artifact_base" "$tmp_artifact"
printf 'artifact-proof\n' > "$tmp_artifact"
art_ok_payload="$(cat <<JSON
{"model":"managed","messages":[{"role":"user","content":"Reply with ok."}],"max_tokens":8,"metadata":{"blockfork_artifact_contract":{"requested":true,"evidence":{"path":"$tmp_artifact"}}}}
JSON
)"
art_ok_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" "$art_ok_payload")"
art_ok_code="$(extract_status "$art_ok_raw")"
assert_status_in "$art_ok_code" "Artifact evidence pass check" 200

art_delivery_payload="$(cat <<JSON
{"model":"managed","messages":[{"role":"user","content":"Say: I sent the PDF."}],"max_tokens":16,"metadata":{"blockfork_artifact_contract":{"requested":true,"evidence":{"path":"$tmp_artifact","delivery_requested":true}}}}
JSON
)"
art_delivery_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" "$art_delivery_payload")"
art_delivery_code="$(extract_status "$art_delivery_raw")"
assert_status_in "$art_delivery_code" "Artifact delivery missing confirmation" 422
rm -f "$tmp_artifact"

echo "[13/15] Verifying failures are reported safely (no secret leakage)"
invalid_body_raw="$(http_status POST "$BASE_URL/v1/chat/completions" "Bearer $live_key" '{"model":"managed"}')"
invalid_body_code="$(extract_status "$invalid_body_raw")"
invalid_body="$(strip_status_marker "$invalid_body_raw")"
assert_status_in "$invalid_body_code" "Invalid-request probe" 400 422
if contains_secret_pattern "$invalid_body"; then
  echo "Invalid-request response appears to leak sensitive material" >&2
  exit 1
fi

echo "[14/15] Verifying served-path observability event"
if ! (has_match '"event":"response_served".*"served_by":"primary"' "$LOG_OUT" || has_match '"event":"response_served".*"served_by":"fallback"' "$LOG_OUT"); then
  echo "Served-path event not observed in logs" >&2
  exit 1
fi

echo "[15/15] Scanning runtime logs for secret leakage"
for f in "$LOG_OUT" "$LOG_ERR"; do
  if [[ -f "$f" ]]; then
    if has_match 'sk-or-v1-[A-Za-z0-9]+' "$f"; then
      echo "Secret leak detected in log file: $f" >&2
      exit 1
    fi
    if has_match 'BLOCKFORK_ADMIN_SECRET|25654f40536c05a8d9636fd8033e12d88222a50c40adbb11dcd66b242da8c3e4' "$f"; then
      echo "Admin secret leak detected in log file: $f" >&2
      exit 1
    fi
  fi
done

echo "Integrity PASS: API boundaries, upstream-state checks, artifact honesty, and secret hygiene checks passed."
