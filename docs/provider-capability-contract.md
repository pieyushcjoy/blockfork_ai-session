# Provider Capability Contract

Date: 2026-05-13
Status: design-only

This document defines the provider capability abstraction for the future Persistent Execution Layer.

It is aligned with:

- `docs/persistent-execution-design-spec.md`
- `docs/execution-identity-spec.md`
- `docs/execution-transition-legality-spec.md`
- `docs/workspace-boundary-contract.md`
- `docs/artifact-evidence-contract.md`
- `docs/batch-4-schema-contract-appendix.md`

It does **not** introduce implementation, routing changes, or public API changes.

## Purpose

Persistent execution must not encode provider-specific behavior directly into execution lifecycle policy.

The provider capability contract exists to:

- expose runtime-usable capability facts in a provider-agnostic way
- let execution policy reason about safety, retryability, and budget without hard-coding provider names
- preserve the current `managed` client abstraction
- support future resume and recovery decisions with consistent provider facts

## Core Principle

Execution policy should depend on **capability facts**, not provider branding.

Examples:

- whether streaming is supported
- whether tool use is supported
- whether artifact claims are high risk
- what timeout profile applies
- what retryability profile applies
- what context window and output limits apply

The runtime may derive these facts from the existing provider/model descriptor system, but the execution layer should consume normalized capability facts rather than raw provider branches.

## Capability Subject

The capability subject is the resolved runtime execution target:

- requested model alias
- resolved model descriptor
- resolved provider
- resolved fallback target if applicable

Capability facts describe what that subject can safely do under runtime policy.

## Required Capability Dimensions

The provider capability contract must eventually define at least these fields conceptually:

### Identity and routing facts

- requested alias
- resolved provider id
- resolved upstream model id
- fallback-eligible target if configured

### Functional capability facts

- chat supported
- streaming supported
- tool use supported
- artifact-claim risk classification
- structured output sensitivity if later introduced

### Reliability capability facts

- timeout profile
- retryability class
- fallback eligibility
- local vs remote provider class

### Budget and scale facts

- context window
- max output tokens
- rate basis or cost basis class
- output reservation expectation

## Capability Normalization Rules

The execution layer must consume normalized facts with these properties:

- stable field meaning across providers
- no hidden provider-specific branching in execution logic
- explicit unknown values rather than silent assumptions
- validated time scope so stale capability decisions can expire

If a capability fact cannot be established confidently, the execution layer must take the conservative path rather than inventing support.

## Minimum Initial Capability Vocabulary

The first implementation should treat the following vocabulary as the minimum normalized capability set:

- `supports_chat`
- `supports_streaming`
- `supports_tools`
- `artifact_claim_risk`
  - recommended values: `low`, `medium`, `high`, `unknown`
- `timeout_profile`
  - recommended values: `local`, `remote_primary`, `remote_fallback`, `unknown`
- `retryability_class`
  - recommended values: `safe_retryable`, `conditionally_retryable`, `non_retryable`, `unknown`
- `provider_class`
  - recommended values: `local`, `remote`, `unknown`
- `context_window_tokens`
- `max_output_tokens`

This is still a design-level vocabulary, not a wire schema.

## Relationship to Current Runtime

The current runtime already has the raw building blocks for this contract:

- model descriptors with `providerId`, `contextWindow`, `maxTokens`, and `capabilities`
- provider registry entries
- timeout profiles split by local vs non-local behavior
- retryability classification for upstream failure types
- cached capability-contract placeholders in session state

This spec turns those building blocks into an execution-facing contract without changing current behavior.

## Fallback Relationship

Fallback behavior must not be treated as a hidden transport detail for persistent execution.

Capability policy must answer:

- whether fallback is configured
- whether fallback is eligible for the execution path
- whether fallback changes risk posture
- whether fallback changes budget posture

Execution policy should know that fallback happened, but should reason in normalized terms such as:

- alternate capability subject used
- retryability remained safe or became ambiguous
- output/timeout/context envelope changed

## Recovery and Retry Relationship

Provider capability facts directly influence transition legality.

Examples:

- a `safe_retryable` timeout profile may permit automatic transition to `retrying`
- a high artifact-claim risk target may force conservative replay behavior
- missing or stale capability facts may require `recovery_required`

Retry and recovery rules must be explainable from capability facts rather than from provider-specific hard-coded exceptions.

## Capability Validation and Freshness

Capability facts must be treated as time-bounded runtime knowledge.

Required principles:

- capability facts may be cached
- cached capability facts must have validation time
- stale capability facts must expire
- revalidation must happen before relying on capability-sensitive execution decisions when freshness matters

The exact cache duration is an implementation detail, but the freshness model must exist.

## Operator Visibility

Operators must be able to answer:

- which provider/model facts were in effect for an execution
- which normalized capabilities were assumed
- whether capability facts were cached or freshly validated
- whether fallback changed the capability subject
- whether recovery decisions depended on capability uncertainty

This does not require public API exposure now, but it does require future traceability.

## Verification Requirements

Future implementation must include tests for:

- provider capability normalization from current descriptors
- capability freshness and expiry behavior
- fallback capability subject substitution
- retry legality driven by retryability class
- streaming support classification
- artifact-claim risk classification
- unknown capability fallback to conservative execution policy

## Explicit Non-Goals

This contract does not define:

- routing policy itself
- provider onboarding workflow
- public capability API format
- exact capability cache duration
- pricing or billing policy details

Those belong to later implementation design phases.
