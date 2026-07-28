# ADR 0029: use an asynchronous durable proof saga

Status: Accepted

## Context

PostgreSQL and a distributed ledger cannot share one atomic transaction. Waiting
for ledger finality in an HTTP request also creates fragile client timeouts.

## Decision

Proof creation validates the upstream immutable snapshot, stores a `PENDING`
request plus outbox event transactionally, and returns `202`. A leased worker
submits the exact persisted canonical envelope, records every normalized
transaction attempt, stores the provider binding, and transitions the request to
`CONFIRMED`, retryable/permanent failure, or conflict.

The stable proof ID is the ledger idempotency key. Reconciliation queries the
provider recorded on submitted historical bindings after crashes or ambiguous
timeouts. Manual retry reuses the original canonical payload and proof ID.

## Consequences

No cross-system ACID claim is made. Duplicate delivery and worker restart do not
create a different logical proof. Operators can distinguish requested,
submitting, submitted, finalized, retryable, permanent, and conflict outcomes.
