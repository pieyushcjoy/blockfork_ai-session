# Persistent Readiness Prerequisites

This checklist defines what must be complete before implementing Persistent Execution Layer features.

## Required before Phase 4 implementation work

- Routing contract precedence is documented and matches runtime behavior:
  - alias resolution -> provider selection -> fallback policy
- Runtime mode verification matrix is in place and actively used in operations.
- Deterministic fallback drill gate is executable in non-production and included in pre-change validation.
- State ownership boundaries are documented for in-memory vs sqlite truth.
- Artifact evidence contract is documented at operator level.
- Observability thresholds are defined for:
  - fallback attempt rate
  - fallback failure rate
  - upstream failure class distribution
  - readiness regressions (`/v1/preflight` non-ready states)
- Operational hygiene policy is adopted for logs, sqlite files, and environment backups.

## Do not build yet

The following are blocked until all prerequisites above are complete:

- task envelopes
- workspace APIs
- state machines
- event ledgers
- multi-agent orchestration
- memory planes
- persistent execution primitives

## Objective satisfaction map

A prerequisite is only considered complete when the corresponding command passes:

- Deterministic fallback drill gate: `npm run readiness:gate`
- State boundary conformance: `npm run readiness:state-boundary`
- Observability thresholds: `npm run readiness:report`
- Release checklist artifact usage: `docs/release-checklist-template.md`
