# Workspace Boundary Contract

Date: 2026-05-13
Status: design-only

This document defines the workspace and filesystem safety contract for the future Persistent Execution Layer.

It is aligned with:

- `docs/persistent-execution-design-spec.md`
- `docs/execution-identity-spec.md`
- `docs/execution-transition-legality-spec.md`
- `docs/state-boundary-contract.md`

It does **not** introduce implementation, persistence schema, or public API changes.

## Purpose

Persistent execution must not treat the host filesystem as an unbounded working surface.

The workspace boundary contract exists to ensure:

- execution work is scoped to an explicit workspace binding
- filesystem access is constrained to allowed roots
- runtime metadata remains separate from workspace contents
- artifact evidence can be validated against a known workspace boundary
- recovery and resumability do not silently widen access

## Core Boundary Model

### Workspace definition

A workspace is the declared filesystem context within which an execution is allowed to read, write, inspect, and verify work.

A workspace is not:

- the entire machine
- the user home directory by default
- the runtime metadata store
- the execution identity itself

### Workspace binding

Each execution may bind to zero or one workspace context.

Rules:

- no execution may act on filesystem content until its workspace boundary is known
- workspace binding must be treated as durable execution context
- workspace binding must be stable across retry and resume
- rebinding an execution to a different workspace is not allowed implicitly

If a materially different workspace is needed, that must be treated as a new execution or an explicit future operator-approved rebind action.

## Allowed Root Principles

Persistent execution must operate within an explicit allowed-root model.

Required principles:

- every workspace resolves to one canonical root
- every accessed path must normalize under that root
- path traversal outside the root must be rejected
- symlink behavior must be treated conservatively
- multiple allowed roots, if ever supported, must be explicit rather than inferred

The implementation may later introduce a workspace registry or root catalog, but this contract requires the security posture now.

## Path Safety Rules

All filesystem interactions for persistent execution must obey these rules:

1. Normalize before authorize.
2. Authorize against canonical workspace root, not caller-provided path text.
3. Reject relative escape attempts such as `../`.
4. Reject ambiguous path aliases that resolve outside the workspace.
5. Treat symlink-driven escape as a boundary violation unless explicitly approved by future policy.
6. Distinguish read, write, delete, and execute capabilities in future implementation, even if the first implementation keeps them coarse.

## Runtime Metadata Separation

Runtime-owned metadata must not be stored inside the bound workspace by default.

Required separation:

- workspace files are user/project content
- runtime metadata is runtime-owned state
- execution identity, transition history, leases, and recovery records belong to runtime state, not workspace content
- workspace content may reference runtime identities, but it must not define them

This separation prevents project-directory churn from becoming execution-truth churn.

## Workspace Ownership and Authorization

Workspace access is subordinate to execution ownership.

Rules:

- the execution must first be authorized through the owning session/runtime path
- only then may workspace authorization be evaluated
- workspace authorization must confirm that the execution is entitled to act within the bound workspace
- recovery may not widen workspace access without explicit operator approval

The session/live-key trust boundary remains the active entry point. Workspace authorization is an additional constraint, not a replacement for runtime auth.

## Retry and Resume Behavior

Retry and resume must preserve workspace binding.

Rules:

- retry within one execution keeps the same workspace binding
- resume within one execution keeps the same workspace binding
- recovery classification must fail conservatively if workspace binding cannot be reconstructed reliably after restart
- missing or ambiguous workspace binding should move the execution toward `recovery_required`, not silent reattachment

## Artifact Verification Relationship

Artifact evidence must be evaluated relative to the execution’s allowed workspace boundary when the artifact is represented as a filesystem object.

Rules:

- artifact path references must be normalized against the bound workspace
- artifact evidence outside the allowed boundary is not valid by default
- artifact evidence rules must not assume that any path visible to the runtime is valid evidence

This contract works together with the artifact evidence contract and the current artifact honesty guardrail.

## Recovery and Safety Posture

Workspace ambiguity is a recovery concern.

Examples that should trigger conservative handling:

- workspace root missing after restart
- workspace path resolves differently than before
- symlink layout changed across runs
- artifact evidence path no longer matches the prior workspace boundary

Default posture:

- do not auto-recover across workspace ambiguity
- classify as `recovery_required`

## Verification Requirements

Future implementation must include tests for:

- path normalization within allowed root
- path escape rejection
- symlink boundary violation handling
- workspace binding persistence across restart
- retry preserving workspace binding
- resume preserving workspace binding
- recovery classification on missing workspace root
- runtime metadata separation from workspace content

## Explicit Non-Goals

This contract does not define:

- workspace API wire format
- workspace discovery UX
- multi-root workspace support
- file permission matrix details
- artifact schema details
- storage schema

Those belong to later design or implementation phases.
