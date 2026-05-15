# Runtime State Boundary Contract

This document formalizes current state ownership before persistent execution work begins.

## Current ownership model

- In-memory runtime caches:
  - sessions map
  - session-key lookup map
  - live-key lookup maps
- SQLite-backed durability:
  - sessions table and related lifecycle fields
  - live keys and linkage fields
  - request accounting/event records

## Contract boundaries

1. Auth/runtime request path uses runtime-owned validation and session status checks.
2. Session durability exists in sqlite, but request-time hot-path resolution may use in-memory mirrors.
3. Request/event accounting is recorded in sqlite and should be treated as the durable operational ledger for current runtime behavior (not a future persistent execution ledger).
4. Routing decisions are runtime-owned and must remain alias-driven (`managed`) from client perspective.

## Reconciliation expectations (current)

- Runtime should be restart-safe for session and key records persisted in sqlite.
- In-memory caches are acceleration layers and must be reconstructable from persisted state.
- No new state machine semantics should be added before a formal transition contract is accepted.

## Explicit non-goals in this phase

- No task envelope model
- No event-sourced state machine introduction
- No resumable execution primitive
