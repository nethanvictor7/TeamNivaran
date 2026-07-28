# ADR 0021: Stable Cortex gateway boundary

## Status

Accepted

## Decision

Application and worker code depend on `CortexGateway`. Phase 5 binds that
interface only to `MockCortexGateway`. There is no HTTP gateway, provider SDK,
endpoint, credential, or inferred request/response mapping.

## Consequences

The complete platform workflow can be validated deterministically. A live
adapter can be added only after its real contract is available and reviewed.
