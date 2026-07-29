# 0015 — Source triggers are evidence metadata references

## Decision

Integration emits an optional typed evidence-reference projection only for the
explicit `evidence.reference.received` trigger type. Evidence consumes it
idempotently after exact Case resolution and creates `AWAITING_CONTENT` metadata
without a version.

## Consequences

Webhook JSON and SQL rows never become documents. Evidence does not read the
Integration database, raw payloads, Base64 content, BLOBs, or external URLs.
