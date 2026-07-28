# ADR 0028: store only minimal deterministic proof material on-chain

Status: Accepted

## Context

Evidence and decisions can contain regulated or personally identifiable data.
Ledger replication and immutability make accidental disclosure exceptionally
difficult to remediate.

## Decision

Chaincode accepts strict, allowlisted schemas. Evidence assets contain CDEP proof
and immutable evidence IDs, organization/case scope hashes, content and metadata
hashes, optional previous proof ID, schema version, and the transaction-derived
anchor time. Decision assets contain opaque workflow/decision IDs, outcome code,
and evidence-manifest, recommendation, and decision-record hashes.

Unknown fields, invalid identifiers, invalid hashes, and unsupported schemas are
rejected. Evidence bytes, metadata, filenames, case numbers, customer data,
comments, AI content, JWT claims, human actor IDs, and credentials stay
off-ledger.

## Consequences

The ledger proves integrity and chronology without becoming a system of record
for business data. Verification must combine authorized off-ledger retrieval
with the anchored hashes.
