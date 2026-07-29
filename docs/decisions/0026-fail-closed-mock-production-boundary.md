# ADR 0026: Fail-closed mock and production boundary

## Status

Accepted

## Decision

Enabled `MOCK` processing is invalid when `NODE_ENV=production`.
`AI_ADAPTER_MODE=CORTEX` is invalid until the real contract exists. Local
Compose explicitly uses development mode with mock processing.

## Consequences

A deterministic test adapter cannot be mistaken for a production model, and
the absence of a live Cortex contract cannot be hidden by guessed behavior.
