# CDEP Platform

Phase 6 adds provider-neutral evidence and decision proof orchestration backed
by a real local two-organization Hyperledger Fabric network. Fabric is selected
with `LEDGER_PROVIDER=FABRIC`; GCUL deliberately fails startup until its
authoritative adapter contract is available. See
[Phase 6 ledger operations](docs/ledger-phase6.md) and run
`npm run validate:phase6` against the Docker network.

Implementation foundation for the Credit Decision Evidence Platform.

## Implemented in this milestone

- npm workspace monorepo with Node.js 24 and TypeScript
- React/Vite web portal with restrained enterprise glassmorphism
- Lloyds Banking-inspired deep-green palette with original CDEP branding
- NestJS/Fastify API Gateway
- NestJS/Fastify Identity & Access Service
- RS256 access JWTs and JWKS discovery
- Argon2id password hashing
- rotating refresh-token sessions with reuse detection
- organizations, memberships, roles, permissions, users, and transactional outbox
- Prisma schema, initial PostgreSQL migration, and controlled local seed
- Docker Compose for PostgreSQL, Kafka KRaft, Redis, Garage, and ClamAV
- local Docker versus managed-cloud connection switching through environment values
- shared configuration, API-error, authentication, and event-envelope contracts
- independently deployable Case Service with tenant-scoped case management
- case parties, assignments, status timeline, cancellation, idempotent creation,
  optimistic concurrency, and external source references
- transactional case outbox publishing to Kafka
- browser login with memory-only access tokens and HttpOnly refresh sessions
- source-agnostic webhook ingestion for arbitrary JSON objects and arrays
- generic SQL polling adapter contract with a read-only PostgreSQL implementation
- durable watermark/tie-breaker checkpoints, leases, scheduled polling, and run-now
- optional extraction, deterministic Case Service correlation, replay, manual
  resolution, canonical Kafka events, and the case decision journey
- independent Evidence Service with a dedicated database and isolated Prisma
  client
- streamed multipart intake into opaque Garage quarantine keys, exact-byte
  SHA-256 hashing, content-based media detection, and ClamAV scanning
- immutable evidence assets and versions, controlled proxied downloads,
  on-demand integrity verification, lineage, relationships, and legal holds
- leased processing retries, interrupted-upload recovery, orphan reconciliation,
  transactional evidence outbox/inbox, and idempotent Case projections
- real Case Evidence portal with filters, progress/cancel, processing polling,
  version history, integrity results, secure downloads, and hold controls
- independent Validation Workflow Service with a dedicated database and
  isolated Prisma client
- immutable published Workflow definitions, deterministic metadata validation,
  required-Evidence completeness, atomic human task queues, correction cycles,
  recommendations, four-eyes decisions, and idempotent Case synchronization
- real Case Workflow and organization task-queue portal workspaces
- independent Ledger Service with durable proof sagas, reconciliation,
  verification attempts, opaque provider bindings, and transactional events
- deterministic Go proof-registry chaincode and a two-organization Fabric
  network using Raft ordering, LevelDB, and CDEP+Audit endorsement
- evidence-version and decision-package proof panels that distinguish local
  hash, ledger confirmation, and ledger hash results

## Repository layout

```text
apps/
  web-portal/
  api-gateway/
  identity-access-service/
  case-service/
  integration-ingestion-service/
  evidence-service/
  validation-workflow-service/
  ai-assessment-service/
  ledger-service/
chaincode/
  evidence-proof/
packages/
  config/
  contracts/
  errors/
infrastructure/
  docker/
docs/
  decisions/
compose.yaml
```

## Local setup

Requirements:

- Docker Engine with Docker Compose v2

Create local configuration:

```bash
cp .env.example .env
```

Replace every `replace-with-*` value. `GARAGE_RPC_SECRET` must be a random
64-character hexadecimal value.

Build and start the full local stack. Dependency installation, compilation,
migration, and runtime all happen inside Docker images; host npm is not used.

```bash
docker compose --profile local build
docker compose --profile local up -d
```

Local endpoints:

| Component           | URL                     |
| ------------------- | ----------------------- |
| Web portal          | `http://localhost:8080` |
| API Gateway         | `http://localhost:3000` |
| Identity service    | `http://localhost:3001` |
| Case service        | `http://localhost:3002` |
| Integration service | `http://localhost:3003` |
| Evidence service    | `http://localhost:3004` |
| Workflow service    | `http://localhost:3005` |
| AI service          | `http://localhost:3006` |
| Ledger service      | `http://localhost:3007` |
| Garage S3 API       | `http://localhost:3900` |
| ClamAV              | `localhost:3310`        |
| Kafka host listener | `localhost:29092`       |
| PostgreSQL          | `localhost:5432`        |

The seeded administrator credentials are read from `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD` in the ignored local `.env` file.

## Ledger proofs (Phase 6)

The `fabric`/`local` Compose profile starts CDEP and Audit CAs, one peer for each
organization, a single-node Raft orderer, an idempotent channel and chaincode
lifecycle job, and `ledger-service`. Generated MSP material, private keys,
channel artifacts, and peer/orderer state live only in named Docker volumes.

```bash
docker compose --profile fabric up -d
docker compose --profile local up -d
docker compose --profile local ps
docker run --rm --network cdep_cdep-network --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -v "$PWD/scripts:/validator:ro" node:24-bookworm-slim \
  node /validator/validate-phase6.mjs
```

All application requests use JWT identities. Only `ledger-service` reads the
mounted Fabric identity, and provider-specific SDK/configuration knowledge is
confined to `FabricLedgerProvider`. Public APIs and shared events expose CDEP
proof IDs plus opaque provider references, never peer, MSP, certificate, block,
or connection-profile objects.

The chaincode stores hashes and opaque IDs only. Evidence bytes, filenames,
customer/case data, recommendations, comments, AI output, JWT claims, and human
actor details remain off-ledger. Historical proofs retain their recorded
provider binding. A future GCUL change is an additive adapter and explicit
cutover policy; it cannot rewrite existing Fabric anchors.

Phase 6.1 integrates these existing proofs into each decision case. The
directly addressable `Ledger & Verification` tab uses
`GET /api/v1/cases/{caseId}/ledger-summary` and the stable cursor-paginated
`GET /api/v1/cases/{caseId}/proofs`; evidence rows, workflow decision status,
the overview, and activity reuse the same case-scoped queries instead of
issuing one proof request per Evidence Version. Actions remain permission
gated, retries require confirmation, timestamps are shown in UTC, and provider
outages preserve readable proof history.

Case routes use browser-restorable paths:

```text
/cases
/cases/{caseId}/overview
/cases/{caseId}/evidence
/cases/{caseId}/workflow
/cases/{caseId}/ledger
/cases/{caseId}/activity
```

The case register keeps its non-sensitive search, status, priority, and page
state in the URL. Ledger responses are validated against shared contracts in
the portal. Pending proofs poll only while a proof surface is active, use
bounded backoff, and stop after two minutes. A failed background refresh keeps
the last trustworthy proof projection visible.

Run the complete real-Fabric prerequisite plus Phase 6.1 API validator with:

```bash
npm run validate:phase6.1
```

This command validates Compose, rebuilds the affected final source, waits for
Gateway readiness, runs portal type checks, interaction tests and the
production build, checks direct-route fallback, then executes the real
two-organization Fabric API validator. It reads local validator credentials
from the ignored `.env` file.

References:

- [Phase 6 architecture, operations, recovery, and cutover](docs/ledger-phase6.md)
- [Phase 6 OpenAPI](docs/openapi/ledger-phase6.yaml)
- [Provider isolation ADR](docs/decisions/0027-ledger-provider-isolation.md)
- [On-chain minimization ADR](docs/decisions/0028-ledger-on-chain-minimization.md)
- [Asynchronous proof saga ADR](docs/decisions/0029-ledger-proof-saga.md)

## Authentication endpoints

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/jwks
GET  /api/v1/auth/me
```

The browser receives the access token in the response body. The refresh token
is available only through a strict, HttpOnly cookie. The API Gateway validates
RS256 signature, key ID, issuer, audience, expiry, and token type.

## Case API

All case routes are available through the Gateway under `/api/v1/cases`.
Creates accept an `Idempotency-Key`; updates and cancellation require the current
integer `version`. Money is supplied as integer minor units.

```bash
curl -X POST http://localhost:3000/api/v1/cases \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -H "idempotency-key: example-001" \
  --data '{"caseType":"COMMERCIAL_CREDIT","title":"Example case","priority":"NORMAL","requestedAmountMinor":2500000,"currency":"GBP"}'
```

Controlled Docker migrations run automatically through `identity-migrate`,
`case-migrate`, `integration-migrate`, `evidence-migrate`, and
`workflow-migrate` before their services start. Application builds and
validation do not require host-installed npm dependencies.

## Validation, review, and approval (Phase 4)

Phase 4 uses immutable Workflow definition versions and exact Evidence Version
snapshots to drive deterministic validation, human review, correction,
recommendation, and separate final approval/rejection. Four-eyes and
separation-of-duties rules are enforced by the service transaction, not the
portal. Workflow-to-Case synchronization is persisted and idempotent.

See [Phase 4 Workflow operations](docs/workflow-phase4.md) and
[Phase 4 OpenAPI](docs/openapi/workflow-phase4.yaml).

Run the repeatable Phase 4 validator from the Compose network:

```bash
docker run --rm --network cdep_cdep-network --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -v "$PWD/scripts:/validator:ro" node:24-bookworm-slim \
  node /validator/validate-phase4.mjs
```

## Source integration (Phase 2B)

The portal Integrations area uses real `/api/v1/integration` APIs for source
systems, webhook and SQL connectors, credentials, extraction, correlation,
trigger operations, polling history, manual resolution, and the case journey.
There are exactly two connector types in Phase 2B: `WEBHOOK` and `SQL_POLL`.

Start the optional read-only PostgreSQL demonstration source with:

```bash
docker compose --profile integration-demo up -d integration-demo-postgres
docker compose --profile local up -d
```

The demo source is available inside Compose as `integration-demo-postgres:5432`
and from the host on `localhost:55432`. Use database `cdep_source_demo`, user
`DEMO_SOURCE_READER`, and the local-only `DEMO_SOURCE_PASSWORD` from the ignored
`.env` file. Production source accounts
must have only `CONNECT`, schema `USAGE`, and `SELECT`; polling never executes
caller-provided SQL and orders by a validated watermark plus tie-breaker.

Webhook connectors expose:

```text
POST /api/v1/integration/hooks/{connectorKey}
x-cdep-webhook-key: {static connector API key}
x-source-event-id: {optional stable source identifier}
```

The body may be any valid JSON object or array. No request schema, response
schema, or business event definition is configured. Calls without a source ID
are accepted. When an ID is supplied, same-ID/same-bytes returns the original
receipt and same-ID/different-bytes returns `409`. Successful capture returns
`202` with `receiptId`, `status`, `correlationId`, and `receivedAt`.

```bash
curl -i -X POST \
  "http://localhost:8080/api/v1/integration/hooks/$CONNECTOR_KEY" \
  -H "content-type: application/json" \
  -H "x-cdep-webhook-key: $WEBHOOK_KEY" \
  -H "x-source-event-id: source-event-1001" \
  --data '{"application":{"reference":"APP-1001"},"sourceSpecific":{"status":"REFERRED"}}'
```

SQL polling selects only configured columns from one validated table or view.
The checkpoint is the ordered `(watermark, tieBreaker)` pair. Capture of the
batch, checkpoint advancement, and successful run record commit in one
transaction, so a failed transaction cannot skip source rows. A database lease
and scheduler prevent concurrent polling; run-now uses the same path.

Replay reprocesses the immutable stored trigger without calling the source
again. Required-extraction failures and unmatched/ambiguous correlations remain
visible. Manual resolution validates the selected case through Case Service and
records the actor and reason.

> Phase 2B accepts opaque inbound webhook JSON and polls configured PostgreSQL
> tables/views. It does not define webhook payload schemas, customize webhook
> responses, accept arbitrary SQL, or automatically understand source business
> semantics.

Detailed references:

- [Integration API/OpenAPI](docs/openapi/integration-phase2b.yaml)
- [Connector setup and operations](docs/integration-connectors.md)
- [Cloud and security configuration](docs/integration-cloud-security.md)

## Evidence management (Phase 3)

Evidence content is never stored in PostgreSQL or Kafka. Upload requests stream
through the Gateway and Evidence Service into an opaque quarantine object while
enforcing the configured absolute byte limit and calculating SHA-256. Content
is detected from bytes, then a leased worker streams the quarantine object to
ClamAV. Only a clean scan can copy the exact object to a new write-once canonical
key and atomically make the version available.

The default local policy accepts PDF, PNG, JPEG, and plain text up to 10 MiB.
Change `EVIDENCE_ALLOWED_MEDIA_TYPES` and `EVIDENCE_MAX_UPLOAD_BYTES` through
deployment configuration. A declared type is advisory; detected content must be
allowed and agree with the declaration. Infected, unscanned, failed, and rejected
versions cannot receive download access.

Corrections and replacements always create a sequential immutable version with
the prior version ID and hash. Controlled downloads are protected proxied
streams and are recorded without persisting object keys or signed URLs.
Integrity checks asynchronously re-stream canonical bytes and compare a new
hash without changing the authoritative stored hash.

An Integration trigger creates an awaiting evidence reference only when its
explicit trigger type is `evidence.reference.received`, it resolves exactly one
Case, and its allowlisted typed projection contains classification, title, and
external reference. JSON/SQL trigger data is metadata only; URLs, Base64, and
file bytes are never fetched or treated as evidence.

References:

- [Evidence API/OpenAPI](docs/openapi/evidence-phase3.yaml)
- [Evidence upload, storage, access, and cloud configuration](docs/evidence-management.md)
- [Processing recovery and orphan reconciliation runbook](docs/evidence-recovery-runbook.md)

Docker validation commands:

```bash
docker compose --profile local config --quiet
docker compose --profile local build
docker compose --profile local up -d
docker compose --profile local ps
docker run --rm --network cdep_cdep-network --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -v "$PWD:/workspace:ro" -w /workspace node:24-bookworm-slim \
  node scripts/validate-phase2b.mjs

docker run --rm --network cdep_cdep-network --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -e CDEP_RUN_PHASE2B_REGRESSION=true \
  -v "$PWD:/workspace:ro" -w /workspace node:24-bookworm-slim \
  node scripts/validate-phase3.mjs
```

## Cloud switching

Application source and images remain unchanged. Deployment supplies managed
endpoints and credentials through environment variables:

```env
DATABASE_URL=postgresql://service-user:secret@managed-postgres:5432/cdep_identity?sslmode=require
KAFKA_BROKERS=broker-1:9092,broker-2:9092,broker-3:9092
KAFKA_SECURITY_PROTOCOL=SASL_SSL
KAFKA_SASL_MECHANISM=SCRAM-SHA-512
KAFKA_SASL_USERNAME=secret-reference
KAFKA_SASL_PASSWORD=secret-reference
OBJECT_STORAGE_ENDPOINT=https://s3-compatible.example
OBJECT_STORAGE_REGION=managed-region
OBJECT_STORAGE_FORCE_PATH_STYLE=false
OBJECT_STORAGE_ACCESS_KEY=secret-reference
OBJECT_STORAGE_SECRET_KEY=secret-reference
CLAMAV_HOST=managed-scanner.internal
```

No service may query another service database directly.

## Current validation

- Docker-only end-to-end validation covers arbitrary object/array webhooks,
  authentication, optional IDs, idempotency/conflicts, extraction failure and
  replay, SQL read-only connection testing, same-timestamp pagination, durable
  checkpoints, correlation, manual resolution, and journey events
- the integration service exposes `/health/live`, `/health/ready`, and
  Prometheus-format `/metrics`
- controlled migrations run automatically before each service starts
- the Phase 3 validator covers real PostgreSQL, Kafka, Garage, and ClamAV

Phase 3 deliberately does not implement business workflow/approval, AI/OCR,
ledger anchoring, audit search, arbitrary URL retrieval, antivirus-signature
administration, or physical retention disposal.
