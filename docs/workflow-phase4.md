# Phase 4 validation, review, and approval

## Boundary and lifecycle

`validation-workflow-service` owns Workflow configuration and the human decision
record. Case Service owns Case status and timeline; Evidence Service owns exact
immutable Evidence metadata; Identity owns membership and permission.

```text
NOT_STARTED -> EVIDENCE_REQUIRED | READY_FOR_REVIEW
READY_FOR_REVIEW -> UNDER_REVIEW
UNDER_REVIEW -> CORRECTION_REQUESTED | READY_FOR_RECOMMENDATION
CORRECTION_REQUESTED -> validation run N+1
READY_FOR_RECOMMENDATION -> DECISION_PENDING
DECISION_PENDING -> APPROVED | REJECTED
```

Every state change appends history and increments the aggregate version.
Terminal decisions are immutable. Reopening creates a new cycle pinned to a
published definition version.

## Deterministic policy

Only server-owned rule types are supported: required/minimum Evidence, allowed
Evidence state, Evidence age, allowlisted Case field presence/equality/set
membership, and numeric min/max. Definition JSON is strict; unknown fields,
scripts, arbitrary expressions, SQL, JSONPath, and document content are
rejected.

Validation freezes the Case snapshot plus current exact Evidence Version IDs,
SHA-256 hashes, classification, malware status, and availability. Protected
review/recommendation/decision actions recheck those versions through Evidence
Service and return `409` if the snapshot is stale.

## Tasks and human control

Queues are tenant scoped. Claim uses a conditional versioned update, so only
one concurrent claimant wins. Assignment rechecks current Identity membership
and required permission and does not grant authorization.

Recommendations are human advisory records, not decisions. The final action
requires a separate eligible human when four-eyes is enabled. Configurable rules
also prohibit the reviewer or Evidence submitter from deciding.

## Case synchronization and recovery

Workflow commits first, then a persisted `case_sync_operations` command updates
Case status through an idempotent internal API. The worker retries with bounded
backoff and exposes `PENDING`, `SYNCED`, or `FAILED`. Reconciliation never
rewrites Workflow history.

## Operations

- Topics: `cdep.workflow.events.v1`, `cdep.workflow.dlt.v1`
- Consumer group: `cdep-validation-workflow-v1`
- Database: `cdep_workflow`, dedicated credentials
- Timer worker expires overdue open tasks idempotently.
- No rationale, comments, Evidence content, tokens, or customer identifiers are
  emitted to Kafka or metrics.

Run the full Docker validation:

```bash
docker run --rm --network cdep_cdep-network --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -v "$PWD:/workspace:ro" -w /workspace node:24-bookworm-slim \
  node scripts/validate-phase4.mjs
```
