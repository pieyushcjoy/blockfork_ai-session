# Phase 4A Milestones

Date: 2026-05-13
Status: implementation-breakdown-only

This document breaks the Phase 4A implementation plan into concrete milestones and maps each milestone to the exact code areas and test work expected in the current repository.

It is aligned with:

- `docs/phase-4a-implementation-plan.md`
- `docs/persistent-execution-design-spec.md`
- `docs/execution-identity-spec.md`
- `docs/execution-transition-legality-spec.md`
- `docs/workspace-boundary-contract.md`
- `docs/artifact-evidence-contract.md`
- `docs/provider-capability-contract.md`
- `docs/context-budget-observability-contract.md`

## Summary

Phase 4A should be implemented as six concrete milestones:

1. execution durable core
2. transition legality + event recording
3. lease and recovery classifier
4. workspace + artifact boundary attachment
5. provider capability + budget observability
6. verification hardening + readiness regression closure

The current repo shape strongly suggests:

- primary implementation surface: `server.js`
- existing regression surface: `scripts/verify-runtime.sh`, `scripts/verify-api-integrity.sh`, `scripts/verify-state-boundary.sh`, `scripts/verify-readiness-gate.sh`
- current design/docs surface: `docs/*.md`

## Milestone 1: Execution Durable Core

### Goal

Introduce the minimum runtime-owned durable execution model and bind it to the current request/session path.

### Exact code areas

- `server.js`
  - session/auth resolution flow
    - `getSessionFromBearer`
    - `canonicalSessionAuth`
    - `legacySessionAuth`
  - request entrypoints
    - `app.post('/v1/chat/completions', ...)`
    - `app.post('/v1/responses', ...)`
    - legacy `/session/:id/...` compatibility routes
  - request flow core
    - `executeChatFlow`
    - `createRequestId`
  - sqlite/bootstrap area
    - existing table creation/migration block near current `sessions`, `live_keys`, `request_logs`, `session_state`

### Deliverables

- durable execution record model
- `execution_id` generation
- execution-to-session ownership link
- request-to-execution correlation
- optional idempotency linkage placeholder

### Required tests

- new execution record created on first eligible request
- same execution survives runtime restart
- same logical retry reuses `execution_id`
- execution ownership always maps back to exactly one `session_id`

### Suggested test surface

- add a dedicated execution-state verification script, for example:
  - `scripts/verify-execution-core.sh`
- keep existing gates green:
  - `npm run runtime:verify`
  - `npm run runtime:verify:integrity`
  - `npm run readiness:gate`

## Milestone 2: Transition Legality + Event Recording

### Goal

Enforce the execution transition matrix before runtime state changes are accepted.

### Exact code areas

- `server.js`
  - execution flow core around:
    - `executeChatFlow`
    - `proxyStreamingChat`
    - `proxyStreamingResponses`
  - local retry path:
    - `attemptLocalNonStreamRetry`
  - current finalize paths:
    - `finalizeRequest` closures inside streaming handlers
  - failure classification helpers:
    - `isRetryableUpstreamStatus`
    - `failureReasonFromUpstreamStatus`
    - `failureReasonFromFetchError`

### Deliverables

- explicit transition validator
- append-only transition event writer
- illegal transition rejection
- duplicate `running -> running` prevention at transition layer

### Required tests

- transition matrix legality test
- invalid transition rejection test
- no terminal-state reopen test
- no `running -> running` duplicate start test

### Suggested test surface

- new targeted transition script, for example:
  - `scripts/verify-execution-transitions.sh`
- extend `verify-state-boundary.sh` only for static/doc alignment, not behavioral transition proof

## Milestone 3: Lease Model + Recovery Classifier

### Goal

Add single-runner control and conservative interruption classification.

### Exact code areas

- `server.js`
  - execution flow and admission path:
    - `executeChatFlow`
  - streaming runtime behavior:
    - `proxyStreamingChat`
    - `proxyStreamingResponses`
  - local retry branch:
    - `attemptLocalNonStreamRetry`
  - timeout/failure handling:
    - stream timeout paths
    - upstream timeout/unreachable handling
    - fallback success/failure paths

### Deliverables

- execution lease model
- active-runner exclusivity
- stale-running detection entry point
- `recovery_required` classification path
- safe retry vs ambiguous interruption classifier

### Required tests

- duplicate running prevention test
- stale running becomes `recovery_required`
- interrupted streaming classification test
- no blind replay for ambiguous interruption
- safe retry retains same `execution_id`

### Suggested test surface

- new targeted recovery script, for example:
  - `scripts/verify-execution-recovery.sh`
- leverage validation-mode deterministic failure profile for interruption/retry scenarios where practical

## Milestone 4: Workspace + Artifact Boundary Attachment

### Goal

Attach workspace binding and artifact evidence checks to execution-owned state without exposing new public APIs.

### Exact code areas

- `server.js`
  - artifact honesty area:
    - `checkArtifactEvidence`
    - `validateArtifactHonestyOrError`
  - request entrypoints where artifact verification is already applied:
    - non-stream chat completion response handling
    - non-stream responses compatibility handling
  - execution/session ownership path for binding decisions

### Deliverables

- execution-to-workspace binding record
- path normalization and allowed-root enforcement hook
- artifact-to-execution linkage
- explicit artifact verification status attachment

### Required tests

- workspace path escape rejection
- retry/resume preserve workspace binding
- missing workspace on recovery becomes `recovery_required`
- artifact claim rejected without evidence
- artifact claim rejected outside workspace boundary
- artifact accepted with valid execution-linked evidence

### Suggested test surface

- new targeted boundary script, for example:
  - `scripts/verify-workspace-artifact-boundary.sh`
- keep existing integrity checks for artifact honesty as regression coverage

## Milestone 5: Provider Capability + Budget Observability

### Goal

Promote current model/provider facts and budget primitives into execution-owned observability required for retry and recovery decisions.

### Exact code areas

- `server.js`
  - model/provider facts:
    - `MODEL_MAP`
    - `buildProviderRegistry`
    - `normalizeModelForSession`
    - `getProviderConfig`
    - `getDescriptorProviderId`
    - `getRequestTimeoutMs`
    - `getDescriptorRatePer1K`
  - existing capability cache hooks:
    - `getCachedCapabilityContract`
    - session capability contract setters/usages
  - budget primitives:
    - `estimateRequestTokens`
    - `reserveBillingBudget`
    - current output reservation defaults
    - request payload shaping in `buildUpstreamBody` / responses compatibility conversion

### Deliverables

- normalized provider capability object for execution policy
- capability freshness/expiry handling
- requested-vs-accepted budget recording
- truncation/adaptation reason recording
- budget-based rejection classification for execution policy

### Required tests

- provider capability normalization test
- stale capability facts handled conservatively
- fallback capability-subject substitution test
- requested vs accepted budget observability test
- budget overflow not treated as transient retryable outage

### Suggested test surface

- new targeted capability/budget script, for example:
  - `scripts/verify-execution-capabilities-budget.sh`

## Milestone 6: Verification Hardening + Readiness Regression Closure

### Goal

Prove the new execution layer does not regress current runtime health and that the new invariants stay enforced.

### Exact code areas

- `package.json`
  - add new execution verification commands
- `scripts/`
  - add the new execution verification scripts from Milestones 1-5
  - potentially extend `verify-readiness-gate.sh` only if a machine-readable execution-state summary becomes necessary for regression proof
- `README.md`
  - update operator verification section only after implementation exists

### Deliverables

- repeatable execution-layer verification commands
- regression matrix for live + validation profiles
- unchanged public endpoint behavior with added internal persistence semantics

### Required tests

- all new execution verification scripts pass
- existing runtime/integrity/readiness gates remain green
- live profile regression pass
- validation profile regression pass

### Required command set

- `npm run runtime:verify`
- `npm run runtime:verify:integrity`
- `npm run readiness:state-boundary`
- `npm run readiness:gate`
- `ENV_FILE=.env.validation npm run readiness:gate`
- new execution verification commands added in this milestone

## Cross-Milestone Guardrails

These rules apply across every milestone:

- do not change public runtime APIs
- do not add new public endpoints during Phase 4A
- do not change alias-driven routing contract
- do not weaken live or validation readiness gates
- do not implement autonomous replay/recovery workers
- do not expose `execution_id` publicly yet

## Exact Repo Mapping Summary

### Primary code file

- `server.js`
  - this is the main implementation surface for:
    - execution identity
    - transitions
    - retry/recovery classification
    - workspace/artifact attachment
    - provider capability exposure
    - context budget observability

### Existing verification scripts to preserve

- `scripts/verify-runtime.sh`
- `scripts/verify-api-integrity.sh`
- `scripts/verify-state-boundary.sh`
- `scripts/readiness-report.sh`
- `scripts/verify-readiness-gate.sh`

### Likely new verification scripts

- `scripts/verify-execution-core.sh`
- `scripts/verify-execution-transitions.sh`
- `scripts/verify-execution-recovery.sh`
- `scripts/verify-workspace-artifact-boundary.sh`
- `scripts/verify-execution-capabilities-budget.sh`

These filenames are the recommended landing shape because they match the current repo’s script-driven verification style.

## Recommended First Implementation Cut

If implementation starts immediately, the safest first cut is:

1. Milestone 1
2. Milestone 2
3. minimal Milestone 3

That gets durable identity, legal transitions, and single-runner protection in place before boundary, artifact, capability, and budget layers attach.

## Ready-to-Implement Conclusion

Phase 4A is now broken down into concrete milestones with:

- exact code areas
- exact verification targets
- exact ordering

The remaining step before coding is choosing whether to implement:

- one milestone at a time, or
- Milestones 1 and 2 together as the first engineering batch

Given the current repo shape, the recommended start is:

- **Batch 1 = Milestones 1 + 2**
- **Batch 2 = Milestone 3**
- **Batch 3 = Milestones 4 + 5**
- **Batch 4 = Milestone 6**
