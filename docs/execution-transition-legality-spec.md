# Execution Transition Legality Spec

Date: 2026-05-13
Status: design-only

This document defines the canonical transition legality model for the future Persistent Execution Layer.

It is aligned with:

- `docs/persistent-execution-design-spec.md`
- `docs/state-boundary-contract.md`

It does **not** implement state transitions, persistence, or public API changes.

## State Machine Principles

The execution transition model follows these rules:

1. Runtime owns all execution transitions.
2. Every transition is an append-only recorded fact.
3. Retry is not completion.
4. Resume is not a new execution.
5. Only one active lease-holder may drive `running` work at a time.
6. Terminal states are explicit and may not silently reopen.
7. Ambiguous interruption is classified conservatively.

## Canonical States

### `created`

- Meaning:
  - Execution record exists but has not yet been admitted into active scheduling.
- Allowed inbound transitions:
  - none
- Allowed outbound transitions:
  - `queued`
  - `cancelled`
  - `expired`
- Triggered by:
  - runtime create/admission path
  - operator cancellation before admission
  - policy expiry before admission
- Required event record:
  - `execution_created`
- Transition class:
  - request-triggered for creation
  - operator-triggered or automatic for cancellation/expiry
- Side effects allowed:
  - no

### `queued`

- Meaning:
  - Execution is admitted and waiting for runtime ownership, lease, or scheduling.
- Allowed inbound transitions:
  - `created`
  - `waiting`
  - `recovery_required`
- Allowed outbound transitions:
  - `running`
  - `cancelled`
  - `expired`
  - `recovery_required`
- Triggered by:
  - runtime scheduler/admission
  - operator requeue after recovery decision
  - automatic expiry
- Required event record:
  - `execution_queued`
- Transition class:
  - automatic, operator-triggered, or request-triggered depending on admission source
- Side effects allowed:
  - no

### `running`

- Meaning:
  - Execution is actively performing work under an exclusive lease.
- Allowed inbound transitions:
  - `queued`
  - `waiting`
  - `retrying`
  - `recovery_required`
- Allowed outbound transitions:
  - `waiting`
  - `retrying`
  - `completed`
  - `failed`
  - `cancelled`
  - `recovery_required`
- Triggered by:
  - runtime lease acquisition
  - operator-approved recovery
- Required event record:
  - `execution_started`
- Transition class:
  - automatic or operator-triggered through recovery
- Side effects allowed:
  - yes

### `waiting`

- Meaning:
  - Execution is paused on an external or runtime condition and is not actively running.
- Allowed inbound transitions:
  - `running`
- Allowed outbound transitions:
  - `queued`
  - `running`
  - `cancelled`
  - `expired`
  - `recovery_required`
- Triggered by:
  - runtime pause condition
  - operator intervention
  - expiry policy
- Required event record:
  - `execution_waiting`
- Transition class:
  - automatic or operator-triggered
- Side effects allowed:
  - no

### `retrying`

- Meaning:
  - Runtime has decided a bounded retry is legal and is preparing or performing that retry sequence.
- Allowed inbound transitions:
  - `running`
- Allowed outbound transitions:
  - `running`
  - `failed`
  - `recovery_required`
  - `cancelled`
  - `expired`
- Triggered by:
  - runtime retry policy
  - operator-directed retry policy in rare cases
- Required event record:
  - `execution_retrying`
- Transition class:
  - automatic by default
- Side effects allowed:
  - no new external side effects should begin until execution re-enters `running`

### `completed`

- Meaning:
  - Execution reached successful terminal completion.
- Allowed inbound transitions:
  - `running`
- Allowed outbound transitions:
  - none
- Triggered by:
  - runtime completion path
- Required event record:
  - `execution_completed`
- Transition class:
  - automatic
- Side effects allowed:
  - no additional side effects after terminalization

### `failed`

- Meaning:
  - Execution reached terminal failure after no more safe retries or recovery paths remain.
- Allowed inbound transitions:
  - `running`
  - `retrying`
  - `recovery_required`
- Allowed outbound transitions:
  - none
- Triggered by:
  - runtime terminal failure classification
  - operator recovery decision to fail
- Required event record:
  - `execution_failed`
- Transition class:
  - automatic or operator-triggered
- Side effects allowed:
  - no

### `cancelled`

- Meaning:
  - Execution reached terminal cancellation by explicit runtime or operator/user intent.
- Allowed inbound transitions:
  - `created`
  - `queued`
  - `running`
  - `waiting`
  - `retrying`
  - `recovery_required`
- Allowed outbound transitions:
  - none
- Triggered by:
  - operator action
  - request-triggered cancellation path
  - runtime cancellation policy
- Required event record:
  - `execution_cancelled`
- Transition class:
  - operator-triggered or request-triggered
- Side effects allowed:
  - no further side effects after cancellation decision

### `expired`

- Meaning:
  - Execution reached terminal expiry due to ownership timeout, TTL, or policy expiry.
- Allowed inbound transitions:
  - `created`
  - `queued`
  - `waiting`
  - `retrying`
  - `recovery_required`
- Allowed outbound transitions:
  - none
- Triggered by:
  - runtime expiry policy
  - operator expiry decision
- Required event record:
  - `execution_expired`
- Transition class:
  - automatic or operator-triggered
- Side effects allowed:
  - no

### `recovery_required`

- Meaning:
  - Execution is blocked after ambiguous interruption or stale ownership and requires explicit recovery classification before it may continue or terminate.
- Allowed inbound transitions:
  - `queued`
  - `running`
  - `waiting`
  - `retrying`
- Allowed outbound transitions:
  - `queued`
  - `running`
  - `failed`
  - `cancelled`
  - `expired`
- Triggered by:
  - runtime recovery classifier
  - operator recovery workflow
- Required event record:
  - `execution_recovery_required`
- Transition class:
  - automatic entry, operator-triggered or controlled runtime exit
- Side effects allowed:
  - no

## Transition Matrix

| From | Allowed to |
| --- | --- |
| `created` | `queued`, `cancelled`, `expired` |
| `queued` | `running`, `cancelled`, `expired`, `recovery_required` |
| `running` | `waiting`, `retrying`, `completed`, `failed`, `cancelled`, `recovery_required` |
| `waiting` | `queued`, `running`, `cancelled`, `expired`, `recovery_required` |
| `retrying` | `running`, `failed`, `recovery_required`, `cancelled`, `expired` |
| `recovery_required` | `queued`, `running`, `failed`, `cancelled`, `expired` |
| `completed` | none |
| `failed` | none |
| `cancelled` | none |
| `expired` | none |

## Explicit Illegal Transitions

The following transitions are explicitly illegal:

- `completed -> running`
  - terminal success must never reopen execution
- `failed -> completed` without an intervening retry/recovery chain
  - terminal failure cannot be rewritten into success
- `cancelled -> running`
  - cancellation is terminal
- `expired -> running` without explicit recovery decision
  - expiry is terminal and may only be superseded by a separately authorized recovery policy in a future design, not direct restart
- `recovery_required -> completed` without recovery/operator event
  - ambiguous interruption must be resolved before completion
- `running -> running`
  - duplicate start under the same or competing lease is forbidden
- any terminal -> non-terminal
  - terminal states are closed
- `created -> completed`
  - work must be admitted and executed, not skipped directly to terminal success
- `queued -> completed` without `running`
  - queued work cannot complete without active execution
- `waiting -> completed` without re-entry into active execution path
  - paused work cannot magically become complete

## Event Requirements

Every transition must produce an event record with at least:

- `execution_id`
- previous state
- new state
- timestamp
- actor/source
- reason code
- request correlation if present
- lease context if present
- notes or evidence reference if operator-driven

This document defines event contract requirements only. It does not define storage schema or wire format.

## Replay and Recovery Rules

### Safe automatic retry

Automatic retry is allowed only for bounded safe failures such as:

- retryable upstream/provider failures
- safe pre-side-effect interruptions
- lease loss before side effects begin

Automatic retry should move through `retrying`, not silently re-enter `running`.

### Operator approval required

Operator approval is required for:

- ambiguous mid-stream interruption
- uncertain side-effect status
- stale running executions after lease expiry
- any recovery from `recovery_required`

### Must never be replayed blindly

The runtime must never blindly replay:

- executions with possible external side effects
- interrupted artifact-producing actions without evidence check
- unknown partial-stream completion cases

### Interrupted streaming classification

- interruption before meaningful output and before side effects:
  - candidate for safe retry
- interruption after partial output or uncertain downstream delivery:
  - classify as `recovery_required`

### Stale running detection

Stale `running` executions are detected in future implementation through lease expiry, missing heartbeat, or missing ownership renewal.

Default legality rule:

- stale `running` becomes `recovery_required`
- stale `running` does **not** automatically become `queued`

### Leases and locks

- `running` requires exactly one active lease
- lease acquisition is prerequisite to entering `running`
- lease loss during `running` triggers recovery classification, not duplicate `running`
- no second worker may enter `running` for the same execution while another lease is active

## Verification Requirements

Future implementation must include tests for:

- transition matrix test
- duplicate running prevention test
- invalid transition rejection test
- crash recovery classification test
- no blind replay test
- idempotent retry test

## Practical Interpretation

This legality model is intentionally conservative:

- safe bounded retries are allowed
- ambiguous interruption is isolated
- recovery is explicit
- terminal states stay terminal

That posture is required to keep future persistence behavior predictable and operator-auditable.

## Explicit Non-Goals

This spec does not define:

- lease timeout values
- heartbeat transport details
- storage schema
- event table schema
- public API exposure
- provider-specific retry matrices

Those belong to later implementation design phases.
