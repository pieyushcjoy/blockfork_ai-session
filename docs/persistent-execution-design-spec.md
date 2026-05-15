# Persistent Execution Layer Design Spec

Date: 2026-05-12
Status: design-only

This document starts the Persistent Execution Layer design phase now that live host readiness and validation readiness gates are green.

## Scope of this document

- Define the problem shape and architecture boundaries for persistent execution.
- Describe the minimum contracts that future implementation must satisfy.
- Sequence the work so we avoid coupling persistence to unstable runtime assumptions.

This document does **not** authorize implementation by itself.

## Current validated baseline

The runtime baseline that this design builds on is:

- Live host runtime readiness gate passing on the primary-local route.
- Validation profile readiness gate passing with deterministic fallback drills enabled.
- Session auth, live-key issuance, routing, integrity checks, and state-boundary checks already in place.

That means we can design against a stable runtime contract rather than designing around unknown operational behavior.

## Problem statement

Today the runtime can serve authenticated requests, route them correctly, and verify integrity, but it does not yet own durable execution lifecycle semantics.

Persistent execution needs the runtime to safely support:

- stable execution identity across time
- resumable work units
- controlled workspace attachment
- durable transition history
- verified artifact reporting
- bounded context growth

The design must preserve the current client-facing `managed` abstraction and avoid leaking internal execution machinery into public API behavior too early.

## Design goals

1. Keep runtime ownership explicit.
2. Make execution identity stable and unambiguous.
3. Separate durable truth from in-memory acceleration layers.
4. Make every state transition observable and explainable.
5. Keep workspace and filesystem access bounded by explicit contracts.
6. Preserve compatibility with current `/v1` request surfaces.
7. Allow resumability later without committing to a replay model too early.

## Non-goals

This design phase does not include:

- task envelope implementation
- event ledger implementation
- checkpoint/replay worker implementation
- memory plane implementation
- multi-agent orchestration implementation
- workspace API implementation
- persistence schema rollout

## Proposed architecture layers

### 1. Session layer

Existing responsibility:

- authenticate callers
- issue and validate session/live keys
- enforce request-time runtime access

Future persistent responsibility:

- map a caller to one or more durable execution identities without changing public auth semantics

### 2. Execution layer

Planned responsibility:

- represent a single runtime-owned unit of persistent work
- own lifecycle status
- bind requests, artifacts, and transitions to a stable execution id

The execution layer should sit between session identity and provider routing.

### 3. Workspace boundary layer

Planned responsibility:

- attach a declared workspace context to an execution
- enforce filesystem scope rules
- separate runtime metadata from workspace contents

### 4. Event and evidence layer

Planned responsibility:

- record durable execution transitions
- record artifact evidence references
- distinguish operator logs from execution truth

### 5. Provider routing layer

Existing responsibility:

- resolve `managed`
- choose provider
- apply fallback

Future persistent responsibility:

- emit provider-capability facts that execution policy can use without hard-coding provider behavior into execution semantics

## Core design entities

These are design entities only, not implementation instructions.

### Execution identity

Required properties:

- globally unique within the runtime
- stable across retries and resumptions
- distinct from session id
- safe to expose in operator tooling

### Execution record

Required fields:

- execution id
- owning session id
- current lifecycle state
- workspace binding reference
- requested model alias
- resolved provider/model facts
- timestamps for creation, lease, completion, failure, cancellation

### Transition record

Required properties:

- append-only
- ordered per execution
- reasoned state changes
- actor/source attribution

### Artifact evidence record

Required properties:

- references durable proof, not just model claims
- links to the execution that produced it
- records verification status separately from model output text

## State model principles

The future state model should follow these rules:

1. Runtime owns transitions, not the client.
2. Each transition must have one durable source of truth.
3. In-memory mirrors may cache state but must never define it.
4. Terminal states must be explicit.
5. Retry and resume must be different concepts.

Recommended lifecycle categories for later formalization:

- created
- admitted
- running
- waiting
- completed
- failed
- cancelled

These are directional placeholders only. Final transition legality should be specified before any schema work begins.

## Workspace and filesystem safety principles

Persistent execution should not assume the whole host filesystem is safe to touch.

Future implementation should require:

- explicit workspace root binding
- normalized path handling
- prohibition on path escape outside allowed roots
- separation between runtime-owned metadata storage and workspace files
- artifact references that can be verified against the allowed workspace boundary

## Event model principles

Current `launchd` and runtime logs are operational evidence, not a durable execution ledger.

The future durable event model should:

- record only contract-worthy execution facts
- avoid mixing debug noise with lifecycle truth
- support reconstruction of the latest execution state
- preserve operator-readable failure reasons

The first implementation step should specify the event contract before choosing storage details.

## Provider capability abstraction

Persistent execution should not encode provider names into lifecycle policy.

Instead, execution policy should eventually depend on capability facts such as:

- streaming supported
- tool use supported
- artifact claim risk level
- timeout profile
- retryability class
- context window

These facts can be derived from provider/model descriptors without exposing provider-specific logic throughout the runtime.

## Context budget observability

Persistent execution will need stronger visibility into context pressure than the runtime currently exposes.

Future design work should define:

- requested context size
- accepted context size
- truncated or compressed context decisions
- reserved output budget
- failure modes when budget is exceeded

This should be specified before resumability is designed, because resume quality depends on context accounting quality.

## Resumability principles

Resumability should be treated as a later outcome of good identity, transition, and evidence design.

Do not begin by designing replay workers first.

Resumability should only be added after:

- execution identity is stable
- transition legality is formalized
- artifact evidence is durable
- context budget observability exists
- workspace boundary rules are explicit

## Recommended design sequence

1. Execution identity contract
2. Transition legality spec
3. Workspace boundary contract
4. Artifact evidence contract
5. Provider capability contract
6. Context budget observability contract
7. Durable storage shape selection
8. Resume semantics

The next concrete design artifacts for this sequence are:

- `docs/execution-identity-spec.md`
- `docs/execution-transition-legality-spec.md`
- `docs/workspace-boundary-contract.md`
- `docs/artifact-evidence-contract.md`
- `docs/provider-capability-contract.md`
- `docs/context-budget-observability-contract.md`
- `docs/phase-4a-implementation-plan.md`

## Open design questions

- Should execution identity be user-visible, operator-visible, or both?
- Should a session own multiple executions concurrently?
- What is the minimum durable event set required to reconstruct state?
- Which artifact evidence types are first-class at launch?
- How should runtime-level cancellation interact with provider-level in-flight work?
- What context-budget decisions must be recoverable after restart?

## Entry criteria for implementation

Do not implement Persistent Execution Layer code until:

- live host `npm run readiness:gate` remains green
- validation profile `ENV_FILE=.env.validation npm run readiness:gate` remains green
- this design is reviewed and narrowed into an implementation plan
- transition legality is specified in writing
- workspace boundary rules are specified in writing
- artifact evidence contract is specified in writing

## Safe next design step

Begin Phase 4A implementation with the first milestone batch:

- durable execution core
- transition legality enforcement
