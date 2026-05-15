# Phase 4A Implementation Plan

Date: 2026-05-13
Status: implementation-plan-only

This document turns the current Persistent Execution Layer design set into a concrete Phase 4A implementation plan.

It is aligned with:

- `docs/persistent-execution-design-spec.md`
- `docs/execution-identity-spec.md`
- `docs/execution-transition-legality-spec.md`
- `docs/workspace-boundary-contract.md`
- `docs/artifact-evidence-contract.md`
- `docs/provider-capability-contract.md`
- `docs/context-budget-observability-contract.md`

It does **not** authorize later-phase persistence features beyond the Phase 4A scope defined here.

## Phase 4A Goal

Phase 4A establishes the minimum runtime-owned persistence foundations required to safely introduce durable execution semantics.

The goal is to create:

- durable execution identity
- durable transition recording
- single-runner execution legality
- conservative recovery classification
- workspace and artifact boundary enforcement hooks
- provider-capability and context-budget observability surfaces for execution policy

without yet building:

- user-facing execution APIs
- workspace product APIs
- replay workers
- autonomous recovery workers
- multi-agent orchestration
- memory planes

## Definition of Done

Phase 4A is complete only when all of the following are true:

- the runtime can create and durably store execution records
- execution state changes obey the transition legality contract
- duplicate running is prevented by lease/ownership rules
- retries reuse the same `execution_id`
- ambiguous interruption is classified as `recovery_required`
- workspace binding and artifact evidence hooks exist at the contract boundary
- provider capability facts and context budget facts are recorded in execution-owned runtime state
- live and validation readiness gates remain green

## Explicit Non-Goals

Phase 4A does **not** include:

- public `execution_id` API exposure
- resume API exposure
- general recovery UI or operator console
- event-sourced replay infrastructure
- background recovery daemons
- workspace registry productization
- artifact download/distribution APIs

## Implementation Sequence

### Step 1: Durable execution core

Introduce the minimum persistent execution record and transition record model inside the runtime.

Must include:

- runtime-generated `execution_id`
- owning `session_id`
- current state
- creation timestamp
- last transition timestamp
- request correlation linkage
- optional idempotency linkage
- optional workspace binding reference

Required invariants:

- one execution has exactly one owning session
- one execution has exactly one current state
- retries and resumes do not create a new execution ID

### Step 2: Transition legality enforcement

Implement transition validation at the runtime boundary before any state mutation is accepted.

Must include:

- legal transition matrix enforcement
- explicit rejection of illegal transitions
- append-only transition event recording
- duplicate `running -> running` prevention

Required invariants:

- terminal states stay terminal
- `completed` cannot reopen
- `cancelled` cannot resume
- `failed` cannot become `completed` without legal retry/recovery chain

### Step 3: Lease and active-runner control

Add the minimum single-runner lease model needed to enforce `running` exclusivity.

Must include:

- one active lease per execution
- lease acquisition prerequisite for `running`
- lease loss classification path
- stale-running detection entry point

Required invariants:

- no concurrent active runners for one execution
- stale or broken ownership becomes `recovery_required`, not silent requeue

### Step 4: Retry and recovery classifier

Implement the runtime classifier that chooses between:

- safe automatic retry
- terminal failure
- `recovery_required`

Must include:

- retry classification from provider failure types
- conservative handling for ambiguous stream interruption
- conservative handling for artifact-producing ambiguity
- conservative handling for workspace ambiguity

Required invariants:

- safe retry goes through `retrying`
- ambiguous execution never auto-completes
- no blind replay of side-effectful work

### Step 5: Workspace boundary attachment

Add the execution-owned workspace binding layer at the contract boundary.

Must include:

- execution-to-workspace binding record
- canonical root normalization
- path authorization checks against bound root
- conservative recovery on missing/ambiguous workspace reconstruction

Required invariants:

- retry/resume preserve workspace binding
- execution cannot silently widen filesystem scope
- runtime metadata remains outside workspace content by default

### Step 6: Artifact evidence attachment

Add execution-linked artifact evidence recording and validation hooks.

Must include:

- artifact-to-execution linkage
- explicit evidence verification state
- rejection of claim-only artifacts without evidence
- workspace-relative evidence validation for filesystem artifacts

Required invariants:

- evidence is authoritative, model text is not
- ambiguous artifact state pushes recovery classification

### Step 7: Provider capability normalization

Expose normalized provider capability facts to the execution layer.

Must include:

- normalized capability object for execution policy
- capability freshness/expiry handling
- fallback subject awareness
- retryability and timeout profile exposure

Required invariants:

- execution policy consumes normalized facts, not raw provider names
- unknown capability facts lead to conservative handling

### Step 8: Context budget observability

Expose execution-level context budget facts needed for retry/recovery decisions.

Must include:

- requested vs accepted budget distinction
- reserved output budget recording
- adaptation/truncation recording
- budget rejection classification

Required invariants:

- over-budget is distinguishable from provider outage
- budget ambiguity does not silently resume execution

## Data Ownership Boundaries

Phase 4A must preserve these boundaries:

- session auth remains the `/v1` trust boundary
- execution state is runtime-owned, not client-owned
- workspace files are not execution truth
- runtime logs are not the durable execution ledger
- provider routing remains alias-driven and unchanged for clients

## Suggested Internal Implementation Order

Recommended build order inside the codebase:

1. execution record model
2. transition validator
3. transition event writer
4. lease model
5. retry/recovery classifier
6. workspace binding enforcement hooks
7. artifact evidence linkage hooks
8. capability normalization layer
9. context budget observability layer

This order minimizes circular dependencies and lets legality and recovery rules exist before richer behavior layers attach.

## Test Plan

### Required new tests

- execution identity persistence across restart
- duplicate create collapse using idempotency linkage
- transition matrix legality test
- illegal transition rejection test
- duplicate running prevention test
- stale running to `recovery_required` classification test
- safe retry retains `execution_id`
- interrupted streaming classification test
- no blind replay of artifact-producing ambiguity
- workspace path escape rejection test
- workspace binding persistence across retry/resume
- artifact evidence acceptance/rejection test
- provider capability normalization test
- capability-expiry conservative handling test
- context budget requested-vs-accepted observability test
- budget overflow non-retry classification test

### Required regression checks

These must continue to pass throughout Phase 4A:

- `npm run runtime:verify`
- `npm run runtime:verify:integrity`
- `npm run readiness:state-boundary`
- `npm run readiness:gate`
- `ENV_FILE=.env.validation npm run readiness:gate`

## Rollout Rules

Phase 4A should be landed incrementally behind runtime-owned internal behavior changes, not new public API exposure.

Recommended rollout posture:

- land durable models and validators first
- land recovery classification before any automatic resume behavior
- keep operator visibility internal until stable
- do not expose `execution_id` publicly during Phase 4A

## Blocking Rules for Later Phases

Do not begin later persistence phases until Phase 4A is complete and stable.

Still blocked after Phase 4A starts:

- execution resume APIs
- background recovery workers
- event replay infrastructure
- workspace product APIs
- autonomous multi-step resumability
- memory planes
- multi-agent persistence orchestration

## Acceptance Gate for Starting Phase 4A

Phase 4A implementation is ready to begin when:

- the design docs above are accepted
- live readiness gate is green
- validation readiness gate is green
- implementation stays within the Phase 4A scope in this plan

## Safe Next Step

Break this Phase 4A plan into implementation milestones and map each milestone to concrete code areas and tests.
