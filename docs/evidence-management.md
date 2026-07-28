# Evidence management

## Intake policy

`evidence-service` owns evidence metadata and uses its dedicated
`cdep_evidence` PostgreSQL database. Bytes are streamed to S3-compatible object
storage and are never written to PostgreSQL or a permanent container path.

The local default is 10 MiB and:

- `application/pdf`
- `image/png`
- `image/jpeg`
- `text/plain`

Both settings are deployment configuration. The service rejects unsafe
filenames, traversal/control characters, declared sizes above policy, actual
streams above policy, unsupported detected types, and declared/detected type
mismatches. Plain text receives content safety checks; active content is never
served inline.

Every new asset/version requires `Idempotency-Key`. The same key and request
returns the original `202` operation; a changed fingerprint returns `409`.

## Quarantine and canonical storage

Keys contain only generated UUIDs:

```text
quarantine/{uuid}
canonical/{uuid}
```

They never include case numbers, filenames, customer names, or other PII. The
quarantine object is streamed and hashed, then queued. A worker streams it using
the ClamAV `INSTREAM` protocol. Scanner errors never mean clean.

A clean object is copied to a distinct canonical key. The worker verifies its
size and re-hashes the canonical stream before a database transaction marks the
version `AVAILABLE`, advances the asset current-version pointer, and writes
outbox events. Only then is quarantine cleanup attempted.

Canonical objects and finalized version metadata are write-once. The database
adds an immutable-version trigger as a second line of defence. Phase 3 never
physically deletes canonical evidence.

## Immutable versions and lineage

Every correction, replacement, or declared derived version allocates the next
number under an atomic asset update. Versions after 1 require the previous
version ID and SHA-256. A failed version never changes the current available
version. Explicit asset relationships support `CORRECTS`, `REPLACES`,
`DERIVED_FROM`, `SUPPORTS`, and `RELATED_TO`.

## Access and integrity

The download-grant operation verifies JWT permission, organization, asset,
Case access, and `AVAILABLE` state. It returns a protected Evidence API content
path. The browser retrieves that path with its memory-only bearer token; the
Gateway and Evidence Service independently authorize it. The service records
grant and stream outcomes without storage keys or URLs.

Integrity verification is asynchronous. A worker re-streams canonical bytes,
calculates SHA-256, performs an exact timing-safe comparison, records
`MATCH`/`MISMATCH`/`ERROR`, and emits a minimal event. It never changes the
authoritative hash.

## Source references

Only `evidence.reference.received` canonical triggers can create
`AWAITING_CONTENT` assets. They must have one resolved Case, organization and
source identifiers, and the typed allowlisted projection:

```json
{
  "classificationCode": "BANK_STATEMENT",
  "title": "Current account statement",
  "externalReference": "SOURCE-DOC-42"
}
```

The Evidence inbox and source-trigger uniqueness constraint prevent duplicate
assets. No version is created until a user supplies real file bytes. Integration
raw payloads, SQL BLOBs, Base64 documents, and external URLs are not read.

## Cloud configuration

The same image accepts PostgreSQL TLS through `DATABASE_URL`, managed S3
endpoints/regions/path style and injected credentials, secured Kafka
SSL/SCRAM configuration, and an injected ClamAV-compatible host/port. Buckets
must remain private. Use separate quarantine and canonical buckets or equivalent
strict prefixes and provider controls.
