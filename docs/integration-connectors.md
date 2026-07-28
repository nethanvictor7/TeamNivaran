# Phase 2B connector setup and operations

Phase 2B supports exactly `WEBHOOK` and `SQL_POLL`. Both capture an immutable
source trigger and use the same optional extraction, deterministic correlation,
canonical event, outbox, and decision-journey pipeline.

## Common setup

1. Create a source system and activate it.
2. Create a connector with a lowercase dotted `triggerType`.
3. Store or rotate its credential with `PUT /connectors/:id/credentials`.
4. Optionally configure extraction and correlation.
5. Test the connector and activate it.

Credentials are write-only. The API returns configuration metadata but never the
decrypted secret.

## Webhook

The endpoint is `POST /api/v1/integration/hooks/:connectorKey`. It is public in
the sense that it does not accept a CDEP user JWT; the connector API key in
`x-cdep-webhook-key` authenticates it. `x-source-event-id` is optional.

The body is an opaque JSON object or array. CDEP hashes the exact received bytes,
stores the parsed JSON, and returns a standard receipt. An optional extraction
test sample is configuration-time data only and does not define a schema.

## PostgreSQL polling

Configure host, port, database, SSL mode, schema, table/view, selected columns,
watermark column/type, unique tie-breaker column/type, source record ID column,
optional occurred-at column, polling interval, batch size, timeout, and initial
lookback.

Only identifiers matching the safe allowlist are accepted. Arbitrary SQL fields
are rejected. The generated query selects the configured fields plus checkpoint
columns and uses bound checkpoint values. The source login must report
`transaction_read_only=on`.

Rows are ordered by `(watermark, tie_breaker)`. Multiple rows at one timestamp
are paged by the unique tie-breaker. Batch capture and checkpoint advancement
commit together. Scheduled and run-now execution share a database lease.
Repeated failures increment the connector failure count and eventually pause it.

## Replay and resolution

Replay needs a reason and reuses the stored raw trigger; it never repolls or
calls the webhook source. Required-extraction failures remain visible.
Unmatched and ambiguous triggers can be resolved to a tenant-visible case by a
user with `integration:correlation:resolve`; CDEP audits the actor, prior state,
and reason.

Raw payload retrieval is a separate endpoint requiring
`integration:payload:read` and an `x-cdep-access-reason` header. The access is
written to the lifecycle outbox. Canonical Kafka events contain only extracted
fields and a raw payload reference.

## Docker demo and validation

```bash
docker compose --profile integration-demo --profile local up -d
docker exec cdep-integration-demo-postgres-1 \
  bash /docker-entrypoint-initdb.d/00-seed.sh
docker run --rm --network cdep_cdep-network --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -v "$PWD:/workspace:ro" -w /workspace node:24-bookworm-slim \
  node scripts/validate-phase2b.mjs
```
