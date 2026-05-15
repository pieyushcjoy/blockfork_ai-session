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
- Public model contract: clients use `managed`.
- Routing contract (runtime-owned):
  - alias resolution: client `managed` resolves server-side
  - provider selection: if `BLOCKFORK_LOCAL_BASE_URL` is configured, `managed` resolves to `local_openai`; otherwise to `openrouter`
  - fallback evaluation: only on retryable primary failures (timeout/unreachable/429/5xx), and only when fallback is enabled and configured
- Live host readiness posture: primary-local by default, with fallback disabled (`BLOCKFORK_ENABLE_FALLBACK=0`) unless explicitly enabled as a separate operational mode.
- Operational note: runtime defaults and active environment can differ; always treat host `.env` as source of truth for live routing.
- `runtime:verify` meaning: liveness + core API usability (`/health`, `/v1`, session mint, completions/responses).
- `runtime:verify:integrity` meaning: auth boundaries, response-shape checks, upstream-state checks, artifact honesty checks, and secret-hygiene scans.

See [docs/runtime-mode-matrix.md](docs/runtime-mode-matrix.md) for production vs non-production verification coverage.

### Temporary / expected-to-evolve areas

- Reliability controls (timeouts/fallback toggles) are operational guardrails and may be tuned.
- Test-only upstream override hooks are non-production validation plumbing.
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
- `BLOCKFORK_FORCE_PRIMARY_429` (non-production deterministic test toggle)
- `BLOCKFORK_FORCE_PRIMARY_TIMEOUT` (non-production deterministic test toggle)
- `BLOCKFORK_ENABLE_TEST_UPSTREAM_KEY_OVERRIDE` (non-production deterministic test toggle)

## Troubleshooting Runbook

### Restart and Reconciliation Verification

Use this lightweight procedure after runtime restart or launchd churn to confirm state reconstructability:

1. Run `npm run runtime:restart` and wait 3-5 seconds.
2. Run `npm run runtime:verify` then `npm run runtime:verify:integrity`.
3. Run `npm run readiness:state-boundary` to confirm routing/state-contract checks still align.
4. Confirm no unexpected skips in `npm run readiness:gate` output summary.


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

4. Readiness gate polluted by historical log noise
- Symptom: `npm run readiness:gate` fails even though current primary-local traffic is healthy.
- Action: confirm live host fallback is disabled, then rerun the gate. The gate evaluates only gate-scoped appended log lines, while deterministic fallback drills remain in `.env.validation`.

## Runtime Ownership Boundaries

For stabilization and future persistent execution readiness, see:

- [Runtime mode matrix](docs/runtime-mode-matrix.md)
- [State boundary contract](docs/state-boundary-contract.md)
- [Persistent readiness prerequisites](docs/persistent-readiness-prerequisites.md)
- [Persistent execution design spec](docs/persistent-execution-design-spec.md)
- [Execution identity spec](docs/execution-identity-spec.md)
- [Execution transition legality spec](docs/execution-transition-legality-spec.md)
- [Workspace boundary contract](docs/workspace-boundary-contract.md)
- [Artifact evidence contract](docs/artifact-evidence-contract.md)
- [Provider capability contract](docs/provider-capability-contract.md)
- [Context budget observability contract](docs/context-budget-observability-contract.md)
- [Batch 4 schema contract appendix](docs/batch-4-schema-contract-appendix.md)
- [Phase 4A implementation plan](docs/phase-4a-implementation-plan.md)
- [Phase 4A milestones](docs/phase-4a-milestones.md)
- [Operational hygiene policy](docs/operational-hygiene.md)

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

## Readiness Gate Commands

- `npm run readiness:state-boundary` - docs-to-runtime conformance check for routing, session status, and sqlite durability assumptions.
- `npm run readiness:report` - observability threshold report (`pass`/`fail`) over shared runtime logs for manual inspection.
- `npm run readiness:gate` - consolidated live host readiness gate; slices only appended log lines from the current gate run and writes machine-readable summary to `logs/readiness-gate-summary.json`.

### Non-production deterministic fallback drills

1. Copy `.env.validation.example` to `.env.validation` and fill secrets.
2. Start runtime in validation mode:
   `ENV_FILE=.env.validation npm run runtime:restart`
3. Run `ENV_FILE=.env.validation npm run readiness:gate`.
4. Restore the live host runtime afterward:
   `npm run runtime:restart`

This path is intended for deterministic fallback verification before routing/retry policy changes. The gate now checks the running runtime profile and fails clearly if the runtime was not started with the requested env file. Enabling fallback in the live host profile is an intentional operational mode change and requires separate validation outside the default live readiness posture.
For the validation profile, prefer `BLOCKFORK_FALLBACK_MODEL=managed` so fallback drills validate routing behavior against the known-good local runtime path rather than external provider quota/auth state.
In validation mode, successful fallback exercise is expected; the gate still fails on fallback failures, unexpected skips, or other readiness regressions.

Persistent Execution Layer remains blocked until the live host `npm run readiness:gate` passes.
