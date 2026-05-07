#!/usr/bin/env bash
set -euo pipefail

# Fast operator smoke check: proves runtime is usable, not just listening.
BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
MODEL="${MODEL:-managed}"
WITH_UI_CHECK="${WITH_UI_CHECK:-0}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"

if [[ "${1:-}" == "--with-ui" ]]; then
  WITH_UI_CHECK="1"
fi

echo "[1/7] Checking listener on 127.0.0.1:3100"
START_TIME="$(date +%s)"
while true; do
  if lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi

  NOW="$(date +%s)"
  if (( NOW - START_TIME >= STARTUP_TIMEOUT_SECONDS )); then
    echo "Listener check failed after ${STARTUP_TIMEOUT_SECONDS}s: nothing bound on 127.0.0.1:3100" >&2
    exit 1
  fi

  sleep 1
done

echo "[2/7] GET /health"
HEALTH_JSON="$(curl -fsS "$BASE_URL/health")"
printf '%s' "$HEALTH_JSON" | rg -q '"ok"\s*:\s*true'

echo "[3/7] GET /v1"
V1_JSON="$(curl -fsS "$BASE_URL/v1")"
printf '%s' "$V1_JSON" | rg -q '"type"\s*:\s*"blockfork_runtime"'

echo "[4/7] POST /v1/session"
SESSION_JSON="$(curl -fsS -X POST "$BASE_URL/v1/session" -H 'content-type: application/json' -d '{}')"

LIVE_KEY="$(printf '%s' "$SESSION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.public_api_key||j.session?.public_api_key||"")})')"

if [[ -z "$LIVE_KEY" ]] || [[ "$LIVE_KEY" != sk_live_* ]]; then
  echo "Failed to extract sk_live_* key from /v1/session" >&2
  exit 1
fi

echo "[5/7] POST /v1/chat/completions"
CHAT_JSON="$(curl -fsS -X POST "$BASE_URL/v1/chat/completions" \
  -H "authorization: Bearer $LIVE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":6}")"
printf '%s' "$CHAT_JSON" | rg -q '"object"\s*:\s*"chat\.completion"'

echo "[6/7] POST /v1/responses"
RESP_JSON="$(curl -fsS -X POST "$BASE_URL/v1/responses" \
  -H "authorization: Bearer $LIVE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"input\":\"ping\",\"max_output_tokens\":16}")"
printf '%s' "$RESP_JSON" | rg -q '"object"\s*:\s*"response"'

if [[ "$WITH_UI_CHECK" == "1" ]]; then
  echo "[7/7] GET / (UI optional check)"
  HTTP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/")"
  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo "UI check failed with HTTP $HTTP_STATUS" >&2
    exit 1
  fi
else
  echo "[7/7] UI check skipped (pass --with-ui or WITH_UI_CHECK=1)"
fi

echo "Verification PASS: BlockFork runtime is healthy and usable."
