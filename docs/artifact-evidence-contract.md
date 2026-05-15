# Artifact Evidence Contract

Date: 2026-05-13
Status: design-only

This document defines the artifact evidence contract for the future Persistent Execution Layer.

It is aligned with:

- `docs/persistent-execution-design-spec.md`
- `docs/execution-identity-spec.md`
- `docs/execution-transition-legality-spec.md`
- `docs/workspace-boundary-contract.md`

It extends the current runtime artifact-honesty posture without changing runtime behavior today.

## Purpose

Persistent execution must distinguish between:

- model claims about artifacts
- verified evidence that an artifact exists and belongs to the execution

The artifact evidence contract exists to ensure:

- artifact claims are tied to durable execution identity
- evidence is verified separately from model text
- recovery does not blindly replay artifact-producing work
- operators can audit why an artifact was accepted or rejected

## Core Model

### Artifact

An artifact is a runtime-recognized output object associated with an execution.

Examples may later include:

- files
- reports
- structured documents
- generated bundles
- other verifiable output objects

### Artifact evidence

Artifact evidence is the proof the runtime uses to justify accepting an artifact claim.

Evidence is not the same thing as the model’s statement that an artifact was created.

### Evidence-first rule

The runtime must treat evidence as authoritative and model text as advisory.

If model text claims an artifact exists but evidence is missing or invalid, the artifact claim must be rejected or marked unverified according to future policy. It must not be silently accepted.

## Relationship to Current Runtime

The current runtime already enforces an artifact-honesty guardrail:

- verifiable evidence is required for artifact-bound claims
- unsupported claims are rejected

This contract generalizes that posture for future persistent execution without changing current endpoints or behaviors.

## Artifact Identity Principles

- every accepted artifact must be linkable to one owning `execution_id`
- one execution may produce many artifacts
- one artifact belongs to one producing execution
- `artifact_id` must be immutable once created
- artifact evidence verification status must be stored separately from model output text

## Evidence Classes

Future implementation may support multiple evidence classes, but the contract should distinguish them conceptually now:

- filesystem evidence
  - path-based proof relative to the bound workspace
- generated metadata evidence
  - runtime-captured attributes such as size, creation timestamp, hash, or content type
- operator evidence
  - operator-confirmed artifact linkage in rare recovery scenarios

The first implementation may start with filesystem evidence only, but it must not collapse all evidence types into plain text claims.

## Minimum Acceptance Rules

An artifact may be accepted only when:

- the owning execution is known
- the artifact is linked to that execution
- the evidence class is recognized
- the evidence is valid under the workspace boundary contract
- the evidence is current enough to support the claim

An artifact must not be accepted if:

- it is based only on model text
- the path lies outside the allowed workspace boundary
- the evidence cannot be reconstructed after restart
- ownership linkage to the execution is missing

## Verification Status

Artifact verification must be explicit.

Recommended conceptual states:

- `verified`
  - evidence is present and valid
- `unverified`
  - claim exists but acceptable evidence is not yet established
- `rejected`
  - evidence failed validation or violated boundary rules

The exact stored representation is deferred, but the distinction must exist.

## Workspace Relationship

Filesystem-backed artifact evidence must be evaluated relative to the bound workspace.

Rules:

- a path alone is not enough; it must also be inside the execution’s allowed workspace boundary
- artifact references outside the boundary are invalid by default
- retry and resume must not silently switch artifact boundary context

This contract depends on the workspace boundary contract for path authorization.

## Retry, Replay, and Recovery Rules

Artifact-producing execution paths are side-effect sensitive.

### Safe behavior

- retries may continue within the same execution when no ambiguous artifact side effect has occurred
- verified artifact records may be attached to the same execution across retries if they refer to the same durable output

### Unsafe behavior

The runtime must never blindly replay:

- artifact-producing work with uncertain side-effect status
- interrupted output generation where it is unclear whether an artifact was already emitted
- artifact claims whose evidence disappeared or changed unexpectedly after restart

### Recovery posture

If artifact state is ambiguous, the execution should move toward `recovery_required` rather than auto-completing or auto-replaying.

## Operator Visibility

Operators must be able to answer:

- which execution produced this artifact
- what evidence was used
- whether the artifact is verified
- why an artifact claim was rejected
- whether recovery was needed before the artifact was accepted

This does not require public API exposure now, but it does require future operator-facing traceability.

## Verification Requirements

Future implementation must include tests for:

- artifact claim rejected without evidence
- artifact claim rejected when evidence is outside workspace boundary
- artifact accepted when evidence is valid and execution-linked
- artifact verification state survives restart
- artifact-producing interruption classified conservatively
- no blind replay of ambiguous artifact side effects
- operator-visible linkage from artifact to execution

## Explicit Non-Goals

This contract does not define:

- artifact public API format
- artifact storage backend
- checksum/hash requirements
- MIME/content-type schema
- artifact download endpoints
- storage retention policy

Those belong to later design and implementation phases.
