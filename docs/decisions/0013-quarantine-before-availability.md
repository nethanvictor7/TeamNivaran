# 0013 — Quarantine before evidence availability

## Decision

Every upload streams into a private quarantine object, is hashed and
content-typed, and receives a ClamAV streaming scan before canonical promotion.
Only an explicit clean result can become `AVAILABLE`. Infection rejects the
version; timeouts, scanner errors, and object failures retry with a bound and
then fail.

## Consequences

HTTP upload returns `202` after durable quarantine rather than waiting for the
scan. Unscanned content cannot be downloaded. Interrupted objects enter delayed
reconciliation and legal-hold checks.
