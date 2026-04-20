#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
ADMIN_SECRET="${ADMIN_SECRET:-}"
SESSION_CREATE_PATH="${SESSION_CREATE_PATH:-/v1/session}"
EXPECT_REJECTION="${EXPECT_REJECTION:-0}"
EXPECT_SESSION_CAP="${EXPECT_SESSION_CAP:-0}"
EXPECT_RATE_LIMIT="${EXPECT_RATE_LIMIT:-0}"
FORCE_REJECT="${FORCE_REJECT:-0}"
EXPECT_FALLBACK="${EXPECT_FALLBACK:-0}"
FAKE_MODEL="${FAKE_MODEL:-gpt-4}"
PROMPT="${PROMPT:-Reply with one short sentence confirming the runtime is working.}"
EXPECT_V1_DESCRIPTOR="${EXPECT_V1_DESCRIPTOR:-1}"

resolve_live_key_session_id() {
  local live_key="$1"
  python3 -c 'import json, sys
live_key = sys.argv[1]
payload = json.load(sys.stdin)
for row in payload.get("data", []):
    if row.get("key") == live_key:
        print(row.get("last_session_id", ""))
        break
else:
    print("")
' "$live_key"
}

if [[ -z "$ADMIN_SECRET" ]]; then
  echo "ADMIN_SECRET is required" >&2
  exit 1
fi

extract_json_field() {
  local field="$1"
  python3 -c 'import json, sys
field = sys.argv[1]
payload = json.load(sys.stdin)
value = payload
for part in field.split("."):
    if isinstance(value, list):
        value = value[int(part)]
    else:
        value = value.get(part)

if isinstance(value, (dict, list)):
    print(json.dumps(value))
elif value is None:
    print("")
else:
    print(value)
' "$field"
}

assert_equals() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $message" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: $message" >&2
    echo "  missing: $needle" >&2
    exit 1
  fi
}

session_json="$(curl -sS -X POST "$BASE_URL$SESSION_CREATE_PATH" -H 'Content-Type: application/json' -d '{}')"
session_id="$(printf '%s' "$session_json" | extract_json_field session_id)"
session_api_key="$(printf '%s' "$session_json" | extract_json_field api_key)"
public_api_key="$(printf '%s' "$session_json" | extract_json_field public_api_key)"
api_key="${public_api_key:-$session_api_key}"
default_model="$(printf '%s' "$session_json" | extract_json_field default_model)"
session_budget_usd="$(printf '%s' "$session_json" | extract_json_field budget.usd)"
session_expires_in="$(printf '%s' "$session_json" | extract_json_field expires_in)"
session_base_url="$(printf '%s' "$session_json" | extract_json_field base_url)"

assert_equals "$default_model" "managed" "Session default model should stay neutral"
if [[ -z "$session_budget_usd" ]]; then
  echo "FAIL: Session budget missing from creation response" >&2
  exit 1
fi
if [[ -z "$session_expires_in" ]]; then
  echo "FAIL: Session expiry missing from creation response" >&2
  exit 1
fi
if [[ -z "$api_key" ]]; then
  echo "FAIL: Session auth key missing from creation response" >&2
  exit 1
fi

if [[ "$EXPECT_V1_DESCRIPTOR" == "1" ]]; then
  v1_json="$(curl -sS "$BASE_URL/v1")"
  descriptor_base_url="$(printf '%s' "$v1_json" | extract_json_field connection.base_url)"
  descriptor_api_key="$(printf '%s' "$v1_json" | extract_json_field connection.api_key)"
  descriptor_model="$(printf '%s' "$v1_json" | extract_json_field connection.default_model)"

  assert_equals "$descriptor_base_url" "$BASE_URL/v1" "GET /v1 should expose the runtime base URL"
  assert_equals "$descriptor_model" "managed" "GET /v1 should expose the managed model alias"
  if [[ -z "$descriptor_api_key" ]]; then
    echo "FAIL: GET /v1 should expose a discovery live key" >&2
    exit 1
  fi

  api_key="$descriptor_api_key"
fi

chat_payload_file="$(mktemp)"
request_prompt="$PROMPT"
request_max_tokens=""

if [[ "$FORCE_REJECT" == "1" ]]; then
  request_prompt="$PROMPT $PROMPT $PROMPT $PROMPT $PROMPT $PROMPT $PROMPT $PROMPT $PROMPT $PROMPT"
  request_max_tokens="8192"
fi

cat > "$chat_payload_file" <<JSON
{
  "model": "$FAKE_MODEL",
  "max_tokens": ${request_max_tokens:-null},
  "messages": [
    {
      "role": "user",
      "content": "$request_prompt"
    }
  ]
}
JSON

chat_raw="$(curl -sS -w $'\n%{http_code}' -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $api_key" \
  -H 'Content-Type: application/json' \
  --data-binary @"$chat_payload_file")"

rm -f "$chat_payload_file"

chat_body="${chat_raw%$'\n'*}"
chat_code="${chat_raw##*$'\n'}"

if [[ "$EXPECT_SESSION_CAP" == "1" ]]; then
  assert_equals "$chat_code" "429" "Session-cap request should be rejected before upstream dispatch"
  assert_contains "$chat_body" '"code":"session_budget_exceeded"' "Session-cap rejection should use the session-budget error code"
elif [[ "$EXPECT_REJECTION" == "1" ]]; then
  if [[ "$chat_code" == "200" ]]; then
    retry_payload_file="$(mktemp)"
    cat > "$retry_payload_file" <<JSON
{
  "model": "$FAKE_MODEL",
  "max_tokens": ${request_max_tokens:-8192},
  "messages": [
    {
      "role": "user",
      "content": "$request_prompt $request_prompt $request_prompt $request_prompt $request_prompt"
    }
  ]
}
JSON
    chat_raw="$(curl -sS -w $'\n%{http_code}' -X POST "$BASE_URL/v1/chat/completions" \
      -H "Authorization: Bearer $api_key" \
      -H 'Content-Type: application/json' \
      --data-binary @"$retry_payload_file")"
    rm -f "$retry_payload_file"
    chat_body="${chat_raw%$'\n'*}"
    chat_code="${chat_raw##*$'\n'}"
  fi

  assert_equals "$chat_code" "502" "Budget-cap request should be rejected at the gateway"
  assert_contains "$chat_body" '"code":"upstream_error"' "Rejected response should use the generic error envelope"
elif [[ "$EXPECT_RATE_LIMIT" == "1" ]]; then
  assert_equals "$chat_code" "200" "Initial request should succeed before the rate limit is hit"
  response_model="$(printf '%s' "$chat_body" | extract_json_field model)"
  assert_equals "$response_model" "managed" "Client response must not expose upstream model details"

  rate_limit_payload_file="$(mktemp)"
  cat > "$rate_limit_payload_file" <<JSON
{
  "model": "$FAKE_MODEL",
  "max_tokens": ${request_max_tokens:-null},
  "messages": [
    {
      "role": "user",
      "content": "$request_prompt"
    }
  ]
}
JSON

  rate_limit_raw="$(curl -sS -w $'\n%{http_code}' -X POST "$BASE_URL/v1/chat/completions" \
    -H "Authorization: Bearer $api_key" \
    -H 'Content-Type: application/json' \
    --data-binary @"$rate_limit_payload_file")"
  rm -f "$rate_limit_payload_file"
  rate_limit_body="${rate_limit_raw%$'\n'*}"
  rate_limit_code="${rate_limit_raw##*$'\n'}"

  assert_equals "$rate_limit_code" "429" "The second request should trip the session rate limit"
  assert_contains "$rate_limit_body" '"code":"rate_limit_exceeded"' "Rate-limit response should use the rate-limit error code"
else
  assert_equals "$chat_code" "200" "Chat request should succeed"
  response_model="$(printf '%s' "$chat_body" | extract_json_field model)"
  assert_equals "$response_model" "managed" "Client response must not expose upstream model details"
  assert_contains "$chat_body" '"object":"chat.completion"' "Chat response should keep the OpenAI-compatible envelope"
fi

summary_json="$(curl -sS "$BASE_URL/admin/api/summary" -H "x-admin-secret: $ADMIN_SECRET")"
if [[ "$EXPECT_V1_DESCRIPTOR" == "1" ]]; then
  live_keys_json="$(curl -sS "$BASE_URL/admin/api/live-keys" -H "x-admin-secret: $ADMIN_SECRET")"
  descriptor_session_id="$(printf '%s' "$live_keys_json" | resolve_live_key_session_id "$api_key")"
  if [[ -n "$descriptor_session_id" ]]; then
    session_id="$descriptor_session_id"
  fi
fi
request_rows_json="$(curl -sS "$BASE_URL/admin/api/requests?session_id=$session_id&limit=20" -H "x-admin-secret: $ADMIN_SECRET")"

summary_used="$(printf '%s' "$summary_json" | extract_json_field used_usd)"
summary_remaining="$(printf '%s' "$summary_json" | extract_json_field remaining_usd)"
summary_percent="$(printf '%s' "$summary_json" | extract_json_field percent_used)"

echo "Session: $session_id"
echo "Used: $summary_used"
echo "Remaining: $summary_remaining"
echo "Percent used: $summary_percent"

row_count="$(printf '%s' "$request_rows_json" | extract_json_field count)"
if [[ -z "$row_count" ]]; then
  echo "FAIL: Admin request count missing" >&2
  exit 1
fi

row_json="$(printf '%s' "$request_rows_json" | python3 -c 'import json, sys
payload = json.load(sys.stdin)
rows = payload.get("data", [])
print(json.dumps(rows[0]) if rows else "")
')"

if [[ -z "$row_json" ]]; then
  echo "FAIL: No request rows returned for the test session" >&2
  exit 1
fi

row_status="$(printf '%s' "$row_json" | extract_json_field status)"
row_failure_reason="$(printf '%s' "$row_json" | extract_json_field failure_reason)"
if [[ "$EXPECT_RATE_LIMIT" == "1" ]]; then
  assert_equals "$row_status" "rejected" "The rate-limited request should be recorded in SQLite"
  assert_equals "$row_failure_reason" "session_rate_limited" "SQLite should record the rate-limit reason"
elif [[ "$EXPECT_SESSION_CAP" == "1" ]]; then
  assert_equals "$row_status" "rejected" "Session-cap rejection should be recorded in SQLite"
  assert_equals "$row_failure_reason" "session_budget_exceeded" "SQLite should record the session-cap reason"
elif [[ "$EXPECT_REJECTION" == "1" ]]; then
  assert_equals "$row_status" "rejected" "Rejected request should be recorded in SQLite"
else
  assert_equals "$row_status" "success" "Successful request should be recorded in SQLite"
fi

row_primary_model="$(printf '%s' "$row_json" | extract_json_field primary_model)"
assert_equals "$row_primary_model" "google/gemma-4-31b-it:free" "Admin logs should keep the primary model fixed to Gemma"

row_fallback_triggered="$(printf '%s' "$row_json" | extract_json_field fallback_triggered)"
if [[ "$EXPECT_FALLBACK" == "1" ]]; then
  assert_equals "$row_status" "success" "Fallback validation should still succeed"
  assert_equals "$row_fallback_triggered" "1" "Admin logs should mark the fallback path"
else
  if [[ "$EXPECT_REJECTION" == "1" ]]; then
    assert_equals "$row_fallback_triggered" "0" "Rejected requests should not trigger fallback"
  fi
fi

row_model="$(printf '%s' "$row_json" | extract_json_field model_used)"
if [[ "$EXPECT_FALLBACK" == "1" ]]; then
  assert_equals "$row_model" "openai/gpt-4o-mini" "Admin logs should show the fallback model when it is used"
fi

if [[ "$EXPECT_RATE_LIMIT" == "1" ]]; then
  second_row_json="$(printf '%s' "$request_rows_json" | python3 -c 'import json, sys
payload = json.load(sys.stdin)
rows = payload.get("data", [])
print(json.dumps(rows[1]) if len(rows) > 1 else "")
')"
  if [[ -z "$second_row_json" ]]; then
    echo "FAIL: Rate-limit smoke test expected two rows" >&2
    exit 1
  fi
  second_row_status="$(printf '%s' "$second_row_json" | extract_json_field status)"
  assert_equals "$second_row_status" "success" "The first request should still be recorded as success"
fi

echo "Smoke test passed."
