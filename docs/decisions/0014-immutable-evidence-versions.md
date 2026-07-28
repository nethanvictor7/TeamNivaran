# 0014 — Immutable canonical keys and version lineage

## Decision

Each evidence version receives a generated canonical object key that is never
reused. Corrections and replacements allocate a new sequential version and
store the previous version ID/hash. Finalized metadata is protected by service
state transitions and a database trigger.

## Consequences

Failed replacements do not change the current version. History remains
verifiable and canonical bytes are never physically deleted in Phase 3.
