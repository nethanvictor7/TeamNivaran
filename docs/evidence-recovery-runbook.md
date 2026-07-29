# Evidence processing recovery runbook

## Signals

Inspect `/health/ready`, `/metrics`, structured logs, job status counts, scan
outcomes, pending outbox count, and orphan candidates. Logs intentionally omit
filenames, object keys, content, credentials, bearer tokens, and signed URLs.

## Leases and retries

Jobs use a generated worker owner and expiring database lease. A worker claims
only pending/retry jobs or an expired lease. Shutdown stops new work and releases
its leases. The reconciler recovers expired leases every 30 seconds.

Failures use bounded exponential backoff up to
`EVIDENCE_PROCESSING_MAX_ATTEMPTS`. Exhaustion marks the version `FAILED` with a
sanitized code; it cannot become available. Recovery is a new immutable version,
not mutation of the failed record.

## Abandoned uploads

An open upload session expires after 30 minutes. Reconciliation marks the
session abandoned and the placeholder version failed. Any possible quarantine
object becomes an `orphan_object_candidate`; it is not deleted until
`EVIDENCE_ORPHAN_SAFETY_PERIOD_HOURS` has elapsed and authoritative state and
legal hold are rechecked.

## Promotion/finalization split failures

If canonical copy succeeds but database finalization fails, record a canonical
candidate. Canonical candidates are retained and reported. Phase 3 never
automatically deletes them. Operations should compare object head/hash and the
version state before any future manual repair.

If a database version references a missing canonical object, integrity checks
fail operationally and preserve the authoritative database hash. Do not upload a
replacement into the old key.

## Legal hold

Before quarantine garbage cleanup, reconciliation checks the latest placed hold
and matching release action. Active hold retains the candidate. Canonical
objects are retained regardless.

## Safe operator sequence

1. Confirm database, object store, ClamAV, and Kafka readiness.
2. Inspect the sanitized job failure code and attempt count.
3. Restore the dependency; allow expired leases/retry jobs to recover.
4. Verify an available version with the integrity-check API.
5. If retries are exhausted, create a replacement/correction version.
6. Never alter a finalized row, overwrite a canonical key, or directly delete a
   canonical candidate.
