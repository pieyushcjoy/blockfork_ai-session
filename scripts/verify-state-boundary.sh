#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_JS="$ROOT_DIR/server.js"
README_MD="$ROOT_DIR/README.md"
STATE_DOC="$ROOT_DIR/docs/state-boundary-contract.md"
MODE_DOC="$ROOT_DIR/docs/runtime-mode-matrix.md"

require_line() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if ! rg -q "$pattern" "$file"; then
    echo "FAIL: $label" >&2
    exit 1
  fi
  echo "PASS: $label"
}

echo "[1/7] Alias -> provider precedence check"
require_line "$SERVER_JS" "providerId: BLOCKFORK_LOCAL_BASE_URL \? 'local_openai' : 'openrouter'" "managed alias routes local first when configured"

echo "[2/7] Provider registry contract check"
require_line "$SERVER_JS" "openrouter:" "openrouter provider declared"
require_line "$SERVER_JS" "local_openai:" "local_openai provider declared"

echo "[3/7] Fallback retryability contract check"
require_line "$SERVER_JS" "isRetryableUpstreamStatus" "retryability helper present"
require_line "$SERVER_JS" "fallback_attempt_started" "fallback attempt event emitted"

echo "[4/7] Session status handling check"
require_line "$SERVER_JS" "session_expired" "expired-session path present"
require_line "$SERVER_JS" "runtime_not_ready" "runtime-not-ready path present"

echo "[5/7] SQLite durability assumptions check"
require_line "$SERVER_JS" "CREATE TABLE IF NOT EXISTS sessions" "sessions table present"
require_line "$SERVER_JS" "CREATE TABLE IF NOT EXISTS live_keys" "live_keys table present"
require_line "$SERVER_JS" "CREATE TABLE IF NOT EXISTS request_logs" "request_logs table present"

echo "[6/7] Docs alignment check"
require_line "$README_MD" 'provider selection: if `BLOCKFORK_LOCAL_BASE_URL` is configured' "README routing contract note present"
require_line "$STATE_DOC" "In-memory runtime caches" "state boundary doc present"
require_line "$MODE_DOC" "deterministic 429 probe" "runtime mode matrix deterministic probe coverage present"

echo "[7/7] Restart/reconciliation guidance check"
require_line "$README_MD" "Restart and Reconciliation Verification" "runbook restart/reconciliation section present"

echo "State boundary conformance PASS"
