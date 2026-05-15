# Release Readiness Checklist Template

Date:
Environment:
Operator:

## Gate outputs

- Live host `npm run readiness:gate` status:
- Summary artifact path:
- Summary artifact reviewed: yes/no
- Gate used fresh appended log slices: yes/no

## Verification evidence

- `runtime:verify` pass: yes/no
- `runtime:verify:integrity` pass: yes/no
- Deterministic checks skipped:
- Skip rationale documented: yes/no

## State boundary conformance

- `npm run readiness:state-boundary` pass: yes/no
- Routing precedence confirmed: yes/no
- Session status handling confirmed: yes/no
- SQLite durability assumptions confirmed: yes/no

## Observability report

- Manual/shared-log `npm run readiness:report` pass: yes/no
- fallback attempt rate:
- fallback failure rate:
- preflight not-ready rate:
- upstream unknown error rate:

## Validation profile fallback drill

- `ENV_FILE=.env.validation npm run readiness:gate` status:
- Runtime restarted into validation mode first: yes/no
- Validation fallback target set to `managed` unless intentionally testing an external provider: yes/no
- Fallback path intentionally exercised: yes/no
- Validation gate tolerated expected fallback exercise but no fallback failures: yes/no
- If failed, failure accepted as strict validation signal: yes/no

## Operational hygiene checkpoint

- Repo tracked-file cleanliness verified: yes/no
- Logs rotated/retained per policy: yes/no
- `.env.backup.*` handling verified: yes/no
- sqlite runtime data handling verified: yes/no

## Blocking guardrail

Persistent execution work remains blocked unless all prerequisites are green:

- [ ] Routing contract and verification matrix active
- [ ] Live host readiness is primary-local with fallback disabled by default
- [ ] Deterministic fallback drills passing in non-production
- [ ] State boundary conformance passing
- [ ] Readiness report within thresholds
- [ ] Operational hygiene checks complete

## Do not touch yet

Do not implement until all boxes above are checked:

- task envelopes
- workspace APIs
- state machines
- event ledgers
- multi-agent orchestration
- memory planes
- persistent execution primitives
