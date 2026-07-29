# ADR 0020: Workflow-to-Case eventual consistency

Workflow commits authoritative human history and an idempotent synchronization
operation in its database. Case Service applies status/timeline changes through
a trusted command and inbox deduplication. Bounded retries and reconciliation
avoid distributed transactions without duplicating Case history.
