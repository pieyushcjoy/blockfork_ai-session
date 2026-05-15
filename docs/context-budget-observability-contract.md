# Context Budget Observability Contract

Date: 2026-05-13
Status: design-only

This document defines the context budget observability contract for the future Persistent Execution Layer.

It is aligned with:

- `docs/persistent-execution-design-spec.md`
- `docs/provider-capability-contract.md`
- `docs/execution-transition-legality-spec.md`
- `docs/artifact-evidence-contract.md`
- `docs/batch-4-schema-contract-appendix.md`

It does **not** introduce implementation, API changes, or routing changes.

## Purpose

Persistent execution cannot make safe retry, waiting, or resume decisions without understanding context pressure.

The context budget observability contract exists to ensure the runtime can explain:

- how much context was requested
- how much context was actually accepted
- what output budget was reserved
- whether any truncation, compression, or clipping happened
- whether context pressure contributed to retry, failure, or recovery decisions

## Core Principle

Context budget must be treated as observable runtime state, not an invisible side effect of prompt construction.

If the runtime cannot explain context pressure, it cannot safely reason about:

- resumability quality
- replay safety
- output truncation risk
- provider fit
- artifact claim reliability under constrained output

## Required Budget Facts

The future execution layer must be able to observe at least these facts conceptually:

### Request-side budget facts

- requested input size estimate
- requested output size
- requested model alias
- requested streaming mode if relevant

### Resolved execution budget facts

- resolved provider/model subject
- effective context window
- effective max output tokens
- reserved output budget
- estimated total budget demand

### Runtime adaptation facts

- whether truncation occurred
- whether compression/summarization occurred
- whether messages or tool content were dropped
- whether the request was rejected for budget reasons

### Outcome facts

- whether the execution completed within budget
- whether context pressure contributed to failure
- whether resume would require budget reshaping

## Relationship to Current Runtime

The current runtime already contains budget-related primitives such as:

- model descriptor context windows
- model max token values
- output reservation defaults
- request token estimation
- request reservation and budgeting logic

This contract turns those primitives into an explicit observability requirement for persistent execution.

## Observability Rules

### Rule 1: Requested vs accepted must be distinguishable

The runtime must distinguish between:

- what the caller asked for
- what the runtime attempted to send
- what the provider/model envelope actually allowed

These values must not be collapsed into one opaque number.

### Rule 2: Adaptation must be explicit

If the runtime truncates, compresses, clips, or otherwise reshapes context, that fact must be observable.

Silent reshaping is not acceptable for future persistent execution because it breaks resume and auditability.

### Rule 3: Budget failure must be classifiable

Budget-related failure must be distinguishable from:

- provider outage
- transport timeout
- auth failure
- workspace/artifact policy failure

### Rule 4: Resume quality depends on budget traceability

If a resumed execution would exceed the prior context envelope, the runtime must be able to detect that and choose a conservative path.

## Minimum Initial Budget Vocabulary

The first implementation should be able to express at least:

- `requested_input_tokens_estimate`
- `requested_output_tokens`
- `effective_context_window_tokens`
- `effective_max_output_tokens`
- `reserved_output_tokens`
- `context_adaptation_applied`
- `context_adaptation_reason`
- `budget_rejection_reason`

Recommended `context_adaptation_reason` classes:

- `none`
- `message_truncation`
- `tool_payload_truncation`
- `history_compaction`
- `provider_limit_alignment`
- `unknown`

Recommended `budget_rejection_reason` classes:

- `context_window_exceeded`
- `reserved_output_exceeded`
- `session_budget_exceeded`
- `rate_limit_budget_block`
- `unknown`

This remains conceptual and does not prescribe storage or API schema yet.

## Transition Relationship

Context budget facts influence transition legality.

Examples:

- execution may fail without retry if the request is structurally over budget
- execution may move to `waiting` or `recovery_required` if resume would require unsafe context reshaping
- automatic retry is not appropriate when context pressure, rather than transient provider error, caused the failure

Budget observability must therefore be available to the transition classifier.

## Provider Capability Relationship

Context budget observability depends on provider capability facts such as:

- context window
- max output limit
- streaming support implications
- timeout and retry posture for large payloads

Execution policy must combine provider capability facts and budget facts, but the two contracts stay separate:

- capability says what the target can support
- budget observability says what this execution actually consumed or requested

## Recovery and Replay Relationship

Resume and replay must not assume prior context still fits.

Required principles:

- replay must re-evaluate budget fit
- resume must detect whether preserved history exceeds the current effective envelope
- if budget reconstruction is incomplete, recovery should be conservative
- budget ambiguity should favor `recovery_required` over blind continuation

## Operator Visibility

Operators must be able to answer:

- why an execution was considered over budget
- whether truncation or compaction occurred
- whether output reservation shaped the execution path
- whether budget pressure contributed to failure or recovery classification
- whether resume required context reshaping

This does not require public API exposure now, but it does require future internal/operator traceability.

## Verification Requirements

Future implementation must include tests for:

- requested vs accepted budget distinction
- explicit context adaptation recording
- budget rejection classification
- no automatic retry on deterministic budget overflow
- resume classification with budget mismatch
- output reservation visibility
- provider-capability-informed budget interpretation

## Explicit Non-Goals

This contract does not define:

- exact token counting algorithm
- prompt compaction algorithm
- summary-generation algorithm
- API wire format for budget telemetry
- billing policy

Those belong to later implementation design phases.
