# Operational Hygiene Policy

This policy defines runtime artifact handling during stabilization.

## Tracked vs untracked operational artifacts

- Tracked code/docs: source of truth for runtime behavior and procedures.
- Untracked runtime artifacts: logs, sqlite runtime data, temporary outputs, environment backups.

## Hygiene rules

1. Do not commit runtime logs or sqlite snapshots unless explicitly required for incident forensics.
2. Keep environment backup files (`.env.backup.*`) out of version control and rotate them intentionally.
3. Treat `billing.sqlite` and related sqlite files as runtime data, not configuration.
4. Ensure log retention/rotation is managed by operator workflow for long-running host runtime usage.
5. Before release checkpoints:
   - verify repo tracked-file cleanliness (`git status`)
   - verify runtime checks pass in host context
   - record any expected skipped deterministic checks
6. For live host readiness, treat gate-scoped appended log slices as the authoritative readiness input instead of broad shared-log tails.
7. Keep fallback disabled in the live host readiness profile by default; run deterministic fallback drills only through `.env.validation`.
8. Validation runs are intentional runtime mode switches. Start them with `ENV_FILE=.env.validation npm run runtime:restart`, run the gate, then restore the live host profile with `npm run runtime:restart`.
9. Prefer `BLOCKFORK_FALLBACK_MODEL=managed` in `.env.validation` unless you are explicitly validating an external provider fallback dependency.

## Safety posture

- Operational artifacts must not be relied on as architectural interfaces.
- Persistent execution design must not consume ad-hoc runtime artifact formats before formal contracts exist.
- Persistent Execution Layer remains blocked until the live host readiness gate passes on fresh gate-window log input.
