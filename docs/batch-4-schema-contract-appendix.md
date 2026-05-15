# Batch 4 Schema Contract Appendix

Date: 2026-05-13
Status: active
Scope: internal runtime schema contract for Batch 4

This appendix locks the concrete Batch 4 data model implemented in the runtime.

It is aligned with:

- `docs/provider-capability-contract.md`
- `docs/context-budget-observability-contract.md`
- `docs/phase-4a-implementation-plan.md`

## Purpose

Batch 4 introduced execution-owned persistence for:

- provider capability facts
- context budget observability facts

This appendix defines exact field semantics so naming and classification do not drift in later batches.

## Table: `execution_capabilities`

Primary key:

- `execution_id` (`TEXT`, PK)

### Identity fields

- `requested_model_input` (`TEXT NOT NULL DEFAULT ''`)
  - Raw model value received from caller input.
  - May be empty when caller omitted `model`.
  - Must not be treated as canonical alias.
- `requested_model_alias` (`TEXT NOT NULL`)
  - Canonical alias used for policy decisions after normalization.
  - Must always be alias-safe (`managed` or other supported alias).
- `resolved_model_alias` (`TEXT NOT NULL`)
  - Effective alias of the execution subject at admission or fallback update.
- `resolved_provider_id` (`TEXT NOT NULL`)
  - Effective provider id (`local_openai`, `openrouter`, or future ids).
- `resolved_upstream_model_id` (`TEXT NOT NULL`)
  - Effective upstream model identifier used for routing.

### Fallback fields

- `fallback_model_alias` (`TEXT NOT NULL DEFAULT ''`)
  - Alias of configured fallback subject when applicable.
- `fallback_eligible` (`INTEGER NOT NULL DEFAULT 0`)
  - Boolean-like integer (`0` or `1`) indicating fallback could be used.
- `fallback_used` (`INTEGER NOT NULL DEFAULT 0`)
  - Boolean-like integer (`0` or `1`) indicating fallback actually served the execution.

### Capability flags

- `supports_chat` (`INTEGER NOT NULL DEFAULT 0`)
- `supports_streaming` (`INTEGER NOT NULL DEFAULT 0`)
- `supports_tools` (`INTEGER NOT NULL DEFAULT 0`)

All are boolean-like integers (`0` or `1`).

### Risk and policy classifications

- `artifact_claim_risk` (`TEXT NOT NULL DEFAULT 'unknown'`)
  - Locked vocabulary for Batch 4:
  - `medium`, `high`, `unknown`
- `timeout_profile` (`TEXT NOT NULL DEFAULT 'unknown'`)
  - Locked vocabulary for Batch 4:
  - `local`, `remote_primary`, `remote_fallback`, `unknown`
- `retryability_class` (`TEXT NOT NULL DEFAULT 'unknown'`)
  - Locked vocabulary for Batch 4:
  - `safe_retryable`, `conditionally_retryable`, `unknown`
- `provider_class` (`TEXT NOT NULL DEFAULT 'unknown'`)
  - Locked vocabulary for Batch 4:
  - `local`, `remote`, `unknown`

### Envelope fields

- `context_window_tokens` (`INTEGER NOT NULL DEFAULT 0`)
- `max_output_tokens` (`INTEGER NOT NULL DEFAULT 0`)

### Freshness and source fields

- `validated_at` (`TEXT NOT NULL`)
- `expires_at` (`TEXT NOT NULL`)
- `fact_source` (`TEXT NOT NULL DEFAULT 'descriptor_registry'`)
  - Locked values for Batch 4:
  - `descriptor_registry`
  - `session_cached_contract`

### Audit timestamps

- `created_at` (`TEXT NOT NULL`)
- `updated_at` (`TEXT NOT NULL`)

## Table: `execution_budgets`

Primary key:

- `execution_id` (`TEXT`, PK)

### Requested and effective budget fields

- `requested_input_tokens_estimate` (`INTEGER NOT NULL DEFAULT 0`)
- `requested_output_tokens` (`INTEGER NOT NULL DEFAULT 0`)
- `effective_context_window_tokens` (`INTEGER NOT NULL DEFAULT 0`)
- `effective_max_output_tokens` (`INTEGER NOT NULL DEFAULT 0`)
- `reserved_output_tokens` (`INTEGER NOT NULL DEFAULT 0`)
- `estimated_total_budget_demand` (`INTEGER NOT NULL DEFAULT 0`)
- `accepted_input_tokens_estimate` (`INTEGER NOT NULL DEFAULT 0`)

Semantics:

- `requested_*` reflects caller intent.
- `accepted_input_tokens_estimate` reflects runtime-admitted payload estimate after any shaping.
- `estimated_total_budget_demand` is currently:
  - `requested_input_tokens_estimate + reserved_output_tokens`

### Adaptation and rejection fields

- `context_adaptation_applied` (`INTEGER NOT NULL DEFAULT 0`)
  - Boolean-like integer (`0` or `1`).
- `context_adaptation_reason` (`TEXT NOT NULL DEFAULT 'none'`)
  - Locked values currently observed:
  - `none`
  - `history_compaction`
- `budget_rejection_reason` (`TEXT NOT NULL DEFAULT ''`)
  - Locked values currently observed:
  - `context_window_exceeded`
  - `reserved_output_exceeded`
  - `session_budget_exceeded`
  - `session_rate_limited`
  - empty string when no budget rejection occurred

### Outcome fields

- `completed_input_tokens` (`INTEGER NOT NULL DEFAULT 0`)
- `completed_output_tokens` (`INTEGER NOT NULL DEFAULT 0`)

Semantics:

- Updated from finalization paths.
- Represent finalized observed usage for the execution.

### Audit timestamps

- `created_at` (`TEXT NOT NULL`)
- `updated_at` (`TEXT NOT NULL`)

## Deterministic Budget Rejection Semantics

Batch 4 deterministic pre-dispatch rejection is locked to:

- `requested_output_tokens > effective_max_output_tokens`
  - rejection: `reserved_output_exceeded`
- `estimated_total_budget_demand > effective_context_window_tokens`
  - rejection: `context_window_exceeded`

These are non-retry deterministic failures and should not trigger fallback attempts.

## Retry Conservatism Semantics

Optimistic retry is disallowed when capability facts are:

- missing
- stale (`expires_at` in the past)
- incomplete for provider/upstream identity
- classified as `retryability_class='unknown'`

This is intentional and must remain conservative.

## Migration Contract

Batch 4 migration compatibility requirements:

- additive-only schema changes
- existing DBs must upgrade in place on startup
- no data-destructive migration
- newly added field:
  - `execution_capabilities.requested_model_input` must be added if absent

## Non-goals for this Appendix

This appendix does not define:

- public API payload exposure
- foreign-key enforcement strategy
- cross-process execution ownership semantics
- prompt compaction algorithm details

Those remain governed by broader Phase 4A specs.
