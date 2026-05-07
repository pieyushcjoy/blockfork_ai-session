# BlockFork AI Session Runtime

Provider-grade backend for BlockFork sessions.

## Run (foreground)

```bash
cd /Users/pieyush/Projects/blockfork-ai-session-runtime
npm install
npm start
```

## Always-on Host Runtime (LaunchAgent)

This repo includes a macOS LaunchAgent flow so BlockFork stays up on host and auto-restarts.

### Canonical operator flow

1. Start runtime via LaunchAgent:

```bash
cd /Users/pieyush/Projects/blockfork-ai-session-runtime
npm run runtime:start
```

2. Verify runtime health with full API probe:

```bash
npm run runtime:verify
```

3. Run API integrity verification:

```bash
npm run runtime:verify:integrity
```

4. Optional UI check:

```bash
npm run runtime:verify:ui
```

Only declare runtime healthy when `runtime:verify` and `runtime:verify:integrity` pass.

## Architecture & Operations

- Runtime shape: sessioned, OpenAI-compatible proxy (`/v1/chat/completions`, `/v1/responses`) with live-key auth and per-session controls.
- Provider strategy (current): `managed` is pinned to `google/gemma-4-31b-it:free`.
- Fallback strategy (current default): fallback is disabled by default (`BLOCKFORK_ENABLE_FALLBACK=0`) to avoid accidental paid dependency.
- Controlled fallback philosophy: fallback is an explicit, operator-configured recovery path for retryable upstream failures only (timeout/unreachable/429/5xx), never a silent routing surprise.
- Free-first rationale: primary free Gemma always runs first; fallback is secondary recovery, not primary routing.
- Operational tradeoff:
  - fast fail: fallback disabled, quickest failure visibility during congestion
  - slower but more resilient: fallback enabled + configured, higher completion success under free-tier pressure
- `runtime:verify` meaning: liveness + core API usability (`/health`, `/v1`, session mint, completions/responses).
- `runtime:verify:integrity` meaning: auth boundaries, response-shape checks, upstream-state checks, artifact honesty checks, and secret-hygiene scans.

### Temporary / expected-to-evolve areas

- Free-model reliability controls (timeouts/fallback toggles) are operational guardrails and may be tuned.
- Test-only upstream override hook is non-production validation plumbing.
- Artifact honesty contract is intentionally lightweight and may evolve to a richer artifact protocol.

### Runtime control commands

- `npm run runtime:install` - install/reload LaunchAgent
- `npm run runtime:start` - start/kickstart LaunchAgent runtime
- `npm run runtime:stop` - stop LaunchAgent runtime
- `npm run runtime:restart` - restart LaunchAgent runtime
- `npm run runtime:status` - show LaunchAgent runtime state
- `npm run runtime:logs` - tail LaunchAgent stdout/stderr logs

### Verification commands

- `npm run runtime:verify` - startup usability probe (`/health`, `/v1`, session, completions, responses)
- `npm run runtime:verify:ui` - same probe plus root UI HTTP check
- `npm run runtime:verify:integrity` - API integrity checks:
  - required env key presence (redacted)
  - missing/invalid bearer rejection on auth-required endpoints
  - session field contract and `sk_live_*` issuance
  - `sk_live_*` access to `/v1/models`, `/v1/preflight`, `/v1/runtime`
  - OpenAI-compatible response shape checks for `/v1/chat/completions` and `/v1/responses`
  - model alias list includes `managed`
  - free-upstream state checks (reachable + optional deterministic 429/401 probes)
  - fallback-enabled state checks (optional deterministic 429/timeout probes with fallback event verification)
  - artifact honesty guardrail checks
  - failure payload sanitization and runtime log secret-hygiene scan

## Environment knobs (reliability/fallback)

- `BLOCKFORK_PRIMARY_NON_STREAM_TIMEOUT_MS` (default `5000`)
- `BLOCKFORK_PRIMARY_STREAM_ESTABLISH_TIMEOUT_MS` (default `5000`)
- `BLOCKFORK_LOCAL_STREAM_ESTABLISH_TIMEOUT_MS` (default `20000`)
- `BLOCKFORK_LOCAL_STREAM_IDLE_BEFORE_HEADERS_TIMEOUT_MS` (default `45000`)
- `BLOCKFORK_LOCAL_STREAM_IDLE_AFTER_HEADERS_TIMEOUT_MS` (default `30000`)
- `BLOCKFORK_LOCAL_NON_STREAM_TIMEOUT_MS` (default `30000`)
- `BLOCKFORK_LOCAL_ENABLE_NON_STREAM_RETRY` (default `1`)
- `BLOCKFORK_LOCAL_PROFILE_ENABLE` (default `1`)
- `BLOCKFORK_LOCAL_PROFILE_MAX_MESSAGES` (default `48`)
- `BLOCKFORK_LOCAL_WARMUP_ENABLE` (default `0`)
- `BLOCKFORK_LOCAL_WARMUP_INTERVAL_MS` (default `90000`)
- `BLOCKFORK_LOCAL_WARMUP_TIMEOUT_MS` (default `12000`)
- `BLOCKFORK_ENABLE_FALLBACK` (default `0`)
- `BLOCKFORK_FALLBACK_MODEL` (default empty)
- `BLOCKFORK_FALLBACK_REQUIRE_FREE` (default `1`)
- `BLOCKFORK_FORCE_PRIMARY_429` (non-production test toggle)
- `BLOCKFORK_FORCE_PRIMARY_TIMEOUT` (non-production test toggle)
- `BLOCKFORK_ENABLE_TEST_UPSTREAM_KEY_OVERRIDE` (non-production test toggle)

## Troubleshooting Runbook

### Logs and state

- LaunchAgent plist (installed target):
  - `~/Library/LaunchAgents/com.blockfork.runtime.plist`
- Runtime logs:
  - `/Users/pieyush/Projects/blockfork-ai-session-runtime/logs/launchd.out.log`
  - `/Users/pieyush/Projects/blockfork-ai-session-runtime/logs/launchd.err.log`
- Runtime status:
  - `npm run runtime:status`

### Common failure signatures

1. Port already in use (`127.0.0.1:3100`)
- Symptom: status shows repeated restarts, verify fails at listener check.
- Action: identify conflicting process and free port 3100, then `npm run runtime:restart`.

2. Missing or invalid env/provider key
- Symptom: runtime starts but completion checks fail in `runtime:verify`.
- Action: validate `.env` values (especially `OPENROUTER_API_KEY`), then restart and re-verify.

3. Upstream 429 / provider throttling
- Symptom: primary model request logs show 429 and primary outcome classification logs rate-limited.
- Action: retry verification after brief wait; inspect logs for fallback behavior and upstream status.

## Canonical API

- `POST /session`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /v1/models`
- `GET /v1/runtime`
- `GET /v1/preflight`

## Compatibility API

- `GET /session/:id`
- `POST /session/:id/v1/chat/completions`
- `POST /session/:id/v1/responses`
- `GET /session/:id/v1/models`
- `GET /session/:id/v1/runtime`
- `GET /session/:id/v1/preflight`
