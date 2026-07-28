# CDEP — Credit Decision Evidence Platform

CDEP is a tenant-scoped credit decision operations platform. It combines case
management, source integration, immutable evidence, validation and approval
workflows, controlled AI decision support, and provider-neutral ledger proofs
in one auditable system.

The current local implementation runs as an npm workspace monorepo on Docker
Compose. It uses React, TypeScript, NestJS/Fastify, PostgreSQL, Kafka, Redis,
Garage S3-compatible storage, ClamAV, and a real two-organization Hyperledger
Fabric network.

## Current capabilities

- Tenant-scoped decision cases, parties, assignments, status history, priorities,
  requested amounts, optimistic concurrency, and idempotent creation.
- Webhook and read-only PostgreSQL source connectors with durable checkpoints,
  replay, extraction, correlation, manual resolution, and case journey events.
- Streamed evidence uploads, byte-level SHA-256 hashing, quarantine, ClamAV
  scanning, immutable versions, lineage, integrity checks, legal holds, and
  controlled downloads.
- Immutable workflow definitions, deterministic validation, human task queues,
  correction cycles, recommendations, four-eyes approval or rejection, timers,
  and Case Service synchronization.
- Deterministic MockCortex assessment profiles, pinned evidence references,
  strict output schemas, human feedback and acceptance, runtime profiles, model
  policies, and global processing controls.
- Provider-neutral evidence and decision proof orchestration backed by a real
  local Hyperledger Fabric channel and Go chaincode.
- Case-level ledger summaries, proof history, independent off-ledger and
  on-ledger verification states, retry controls, and provider-outage-safe reads.
- Responsive operational portal workspaces for decision cases, integrations,
  workflow operations, evidence, AI governance, and ledger verification.

GCUL is deliberately not implemented. Setting `LEDGER_PROVIDER=GCUL` fails
closed until an authoritative SDK, signing, contract, and finality contract are
available.

## Architecture

```text
Browser
  │
  ├── Web Portal :8080
  │       └── /api reverse proxy
  │
  └── API Gateway :3000
          ├── Identity & Access :3001 ── PostgreSQL + Redis
          ├── Case Service :3002 ─────── PostgreSQL
          ├── Integration Service :3003  PostgreSQL + Kafka
          ├── Evidence Service :3004 ─── PostgreSQL + Garage + ClamAV
          ├── Workflow Service :3005 ─── PostgreSQL + Kafka
          ├── AI Assessment :3006 ────── PostgreSQL + Kafka
          └── Ledger Service :3007 ───── PostgreSQL + Fabric Gateway
                                                │
                                                └── Fabric channel,
                                                    two peers, orderer,
                                                    Go chaincode
```

Each application service owns its database schema. A service must not query
another service database directly. Cross-service communication uses authenticated
HTTP APIs and versioned Kafka events.

## Service inventory

| Component                   | Responsibility                                                              | Host endpoint           |
| --------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| Web portal                  | React/Vite operations UI and `/api` reverse proxy                           | `http://localhost:8080` |
| API Gateway                 | Authentication enforcement, routing, upload proxying, readiness aggregation | `http://localhost:3000` |
| Identity & Access           | Users, organizations, roles, permissions, JWTs, refresh sessions            | `http://localhost:3001` |
| Case Service                | Decision cases, parties, assignments, lifecycle, case projections           | `http://localhost:3002` |
| Integration Service         | Source systems, webhooks, SQL polling, extraction and correlation           | `http://localhost:3003` |
| Evidence Service            | Evidence assets, versions, scanning, storage, integrity and access          | `http://localhost:3004` |
| Workflow Service            | Validation, review, corrections, recommendation and approval                | `http://localhost:3005` |
| AI Assessment Service       | MockCortex assessments, governance, policies and operations                 | `http://localhost:3006` |
| Ledger Service              | Provider-neutral proof lifecycle, verification and reconciliation           | `http://localhost:3007` |
| PostgreSQL                  | Isolated application databases                                              | `localhost:5432`        |
| Redis                       | Refresh-session and identity runtime support                                | `localhost:6379`        |
| Kafka                       | Versioned domain events and transactional outboxes                          | `localhost:29092`       |
| Garage S3 API               | Evidence quarantine and canonical objects                                   | `http://localhost:3900` |
| ClamAV                      | Evidence malware scanning                                                   | `localhost:3310`        |
| Fabric CDEP peer            | CDEP organization peer/Gateway                                              | `localhost:7051`        |
| Fabric Audit peer           | Audit organization peer                                                     | `localhost:8051`        |
| Fabric orderer              | Raft ordering service                                                       | `localhost:7050`        |
| Integration demo PostgreSQL | Optional read-only connector source                                         | `localhost:55432`       |

## Technology

- Node.js 24 and npm 11 workspaces
- TypeScript 5
- React 19, Vite, TanStack Query, React Hook Form, and Zod
- NestJS 11 with Fastify
- Prisma with PostgreSQL 17
- Kafka in KRaft mode
- Redis 8
- Garage S3-compatible object storage
- ClamAV 1.5
- Hyperledger Fabric 2.5, Fabric CA 1.5, Raft, LevelDB, and Go chaincode
- Docker Engine and Docker Compose v2

## Repository layout

```text
apps/
  web-portal/                    React operations portal
  api-gateway/                   Public API entry point
  identity-access-service/       Authentication and authorization
  case-service/                  Decision case ownership
  integration-ingestion-service Source connector and trigger processing
  evidence-service/              Evidence content and metadata ownership
  validation-workflow-service/   Validation/review/approval workflow
  ai-assessment-service/         Controlled AI assessment and governance
  ledger-service/                Provider-neutral proof orchestration
chaincode/
  evidence-proof/                Fabric proof-registry chaincode
packages/
  config/                        Shared environment helpers
  contracts/                     Shared API and event contracts
  errors/                        Shared correlated API problems
infrastructure/
  docker/                        Garage and PostgreSQL bootstrap
  fabric/                        Local Fabric crypto/channel lifecycle
scripts/                         End-to-end phase validators
docs/                            Architecture, operations, ADRs and OpenAPI
compose.yaml                     Local orchestration
```

## Prerequisites

Required for the complete local stack:

- Docker Engine with Docker Compose v2
- At least 8 GB of memory available to Docker
- `git`

Required for running repository checks directly on the host:

- Node.js `>=24`
- npm `>=11`

Confirm the installed versions:

```bash
docker --version
docker compose version
node --version
npm --version
```

## Clone and configure

```bash
git clone https://gitlab.com/reboot4443731/cdep.git
cd cdep
cp .env.example .env
```

Edit `.env` and replace every `replace-with-*` or `change-me-*` value. Do not
commit `.env`.

Important local values include:

- All PostgreSQL application passwords
- `BOOTSTRAP_ADMIN_PASSWORD`
- `INTERNAL_SERVICE_TOKEN`
- `AI_OUTPUT_ENCRYPTION_KEY` with at least 32 random characters
- `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` as a 32-byte Base64URL key
- `GARAGE_RPC_SECRET` as exactly 64 hexadecimal characters
- `GARAGE_ADMIN_TOKEN`
- Garage object-storage access and secret keys
- `DEMO_SOURCE_PASSWORD` when the integration demo profile is used

Example secret generation commands:

```bash
openssl rand -hex 32
openssl rand -base64 48
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

The generated values must be copied into the matching `.env` fields. Never
paste secrets into source files, Dockerfiles, logs, screenshots, or issue
descriptions.

Validate the resolved Compose configuration before building:

```bash
docker compose --profile local config --quiet
```

## Build and start

### Complete local platform

The `local` profile includes the application services, infrastructure,
migrations, seed job, web portal, and Fabric services required by the current
implementation.

```bash
docker compose --profile local build
docker compose --profile local up -d
docker compose --profile local ps
```

Open the portal:

```text
http://localhost:8080
```

The seeded administrator login is configured by:

```text
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
```

### Build without starting

```bash
docker compose --profile local build
```

Build selected services only:

```bash
docker compose --profile local build \
  cdep-web-portal api-gateway ledger-service
```

### Start without rebuilding

```bash
docker compose --profile local up -d
```

### Rebuild and restart one component

For example, after changing the portal:

```bash
docker compose --profile local build cdep-web-portal
docker compose --profile local up -d cdep-web-portal
```

For an API service:

```bash
docker compose --profile local build ai-assessment-service
docker compose --profile local up -d ai-assessment-service
```

Compose may recheck bootstrap, migration, and dependency jobs when a dependent
service is recreated. These jobs are designed to be idempotent.

### Optional integration demo source

```bash
docker compose --profile integration-demo up -d integration-demo-postgres
docker compose --profile local up -d
```

The demo database is `cdep_source_demo`. The user is read from
`DEMO_SOURCE_READER`, and the password is read from `DEMO_SOURCE_PASSWORD`.

### Fabric-only startup

The `local` profile already includes the Fabric dependencies used by the ledger
service. To operate the Fabric profile explicitly:

```bash
docker compose --profile fabric up -d
docker compose --profile fabric ps
```

The Fabric lifecycle job creates or reuses:

- CDEP and Audit certificate authorities
- CDEP and Audit peers
- A single Raft orderer
- `cdep-proof-channel`
- `cdep-proof-registry` chaincode
- `AND('CDEPMSP.peer','AuditMSP.peer')` endorsement

Generated MSP, TLS, channel, and ledger data are stored in Docker named volumes,
not in the repository.

## Stop, restart, and remove

Stop the application containers while preserving named volumes:

```bash
docker compose --profile local down
```

Restart running services:

```bash
docker compose --profile local restart
```

Stop one service:

```bash
docker compose stop cdep-web-portal
```

Removing volumes permanently deletes local databases, object storage, Fabric
ledger state, generated identities, and local test data:

```bash
docker compose --profile local down -v
```

Use the volume-removal command only when a complete local reset is intended.

## Health, status, and logs

Check container status:

```bash
docker compose --profile local ps
```

Check aggregate Gateway readiness:

```bash
curl -fsS http://localhost:3000/health/live
curl -fsS http://localhost:3000/health/startup
curl -fsS http://localhost:3000/health/ready
```

Check a specific service:

```bash
curl -fsS http://localhost:3004/health/ready
curl -fsS http://localhost:3006/health/ready
curl -fsS http://localhost:3007/health/ready
```

Follow all logs:

```bash
docker compose --profile local logs -f
```

Follow selected logs:

```bash
docker compose logs -f \
  cdep-web-portal api-gateway evidence-service ledger-service
```

Show recent logs:

```bash
docker compose logs --tail=160 api-gateway ledger-service
```

## Host development and repository checks

Install workspace dependencies:

```bash
npm install
```

Run all static checks and tests:

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

Format source:

```bash
npm run format
```

Run only the web portal:

```bash
npm run dev --workspace @cdep/web-portal
```

The Vite development server listens on `http://localhost:5173` and proxies
`/api` to `http://localhost:3000`. The backend stack must already be running.

Portal-specific checks:

```bash
npm run typecheck --workspace @cdep/web-portal
npm run test --workspace @cdep/web-portal
npm run build --workspace @cdep/web-portal
```

Service-specific checks follow the same workspace form:

```bash
npm run typecheck --workspace @cdep/evidence-service
npm run test --workspace @cdep/evidence-service
npm run build --workspace @cdep/evidence-service
```

## End-to-end validation

Validators require the local stack, the ignored `.env` file, and the seeded
users. Validators create controlled test records and may exercise global
processing controls before restoring them.

### Complete UI, API, and Fabric regression

Phase 6.1 is the current unattended regression entry point:

```bash
npm run validate:phase6.1
```

It:

1. validates Compose configuration;
2. rebuilds the portal, Gateway, and Ledger Service;
3. starts the required services;
4. waits for Gateway readiness;
5. runs portal typecheck, component tests, and production build;
6. verifies direct-route SPA fallback;
7. runs the real Fabric prerequisite and case-ledger API validators.

### Direct validators from the Compose network

The following pattern avoids mixing Docker-only DNS names with the host shell:

```bash
docker run --rm \
  --network cdep_cdep-network \
  --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -v "$PWD/scripts:/validator:ro" \
  node:24-bookworm-slim \
  node /validator/validate-phase5.mjs
```

Change the final filename to run another validator:

```text
validate-phase2b.mjs
validate-phase3.mjs
validate-phase4.mjs
validate-phase5.mjs
validate-phase6.mjs
validate-phase6.1.mjs
```

Phase 3 can include its Phase 2B regression:

```bash
docker run --rm \
  --network cdep_cdep-network \
  --env-file .env \
  -e CDEP_BASE_URL=http://api-gateway:3000 \
  -e CDEP_RUN_PHASE2B_REGRESSION=true \
  -v "$PWD/scripts:/validator:ro" \
  node:24-bookworm-slim \
  node /validator/validate-phase3.mjs
```

### Host validator form

When running a validator directly on the host, use the host Gateway URL and
export the required bootstrap values from a secure shell environment:

```bash
CDEP_BASE_URL=http://localhost:3000 npm run validate:phase6
```

The Docker-network form is preferred because `--env-file .env` supplies the
validator credentials without manually exporting them.

## Docker Compose profiles

| Profile            | Purpose                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `local`            | Complete local application platform, including Fabric dependencies                      |
| `infrastructure`   | PostgreSQL, Redis, Kafka, Garage, ClamAV and bootstrap jobs                             |
| `fabric`           | Fabric CAs, peers, orderer, crypto bootstrap, lifecycle and Ledger Service dependencies |
| `integration-demo` | Optional read-only PostgreSQL source used by connector validation                       |

List the resolved services:

```bash
docker compose config --profiles
docker compose --profile local config --services
```

## Authentication and authorization

Authentication endpoints:

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/jwks
GET  /api/v1/auth/me
```

The browser keeps the short-lived access token in memory. Refresh tokens use
rotating strict HttpOnly cookies with reuse detection. The Gateway validates
the RS256 signature, key ID, issuer, audience, expiry, token type, organization,
and permission claims.

The local seed includes configurable administrator, reviewer, approver, auditor,
and outsider users. They intentionally have different permissions so validators
can prove tenant isolation, four-eyes controls, and action restrictions.

## Portal routes

Primary workspaces:

```text
/cases
/integrations
/workflow
/ai-governance
```

Case workspaces:

```text
/cases/{caseId}/overview
/cases/{caseId}/parties
/cases/{caseId}/assignments
/cases/{caseId}/evidence
/cases/{caseId}/workflow
/cases/{caseId}/assessment
/cases/{caseId}/ledger
/cases/{caseId}/activity
```

Case register search, status, priority, and page state are stored in the URL.
Case tab routes support refresh and browser history. Inactive case tabs are
unmounted so they do not continue issuing background requests.

## Case management

Case Service owns:

- case type, title, description, priority, currency, and requested amount;
- parties and assignments;
- controlled status transitions and cancellation;
- tenant scope and stable external references;
- optimistic row versions;
- transactional outbox events;
- evidence availability projections.

Case creation requires `Idempotency-Key`. Mutations that can conflict require
the current integer row version. Monetary values are supplied as integer minor
units.

Example:

```bash
curl -X POST http://localhost:3000/api/v1/cases \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -H "idempotency-key: example-case-001" \
  --data '{"caseType":"COMMERCIAL_CREDIT","title":"Example case","priority":"NORMAL","requestedAmountMinor":2500000,"currency":"GBP"}'
```

## Source integration

The Integration Service supports exactly two connector types:

- `WEBHOOK`
- `SQL_POLL`

Webhook payloads may be JSON objects or arrays. Stable source event IDs provide
idempotency: the same ID and bytes return the original receipt, while the same
ID with different bytes returns `409`.

```text
POST /api/v1/integration/hooks/{connectorKey}
x-cdep-webhook-key: {connector API key}
x-source-event-id: {optional stable source event ID}
```

SQL polling permits only configured identifiers and selected columns from one
table or view. It never executes caller-provided SQL. Its checkpoint is the
ordered `(watermark, tieBreaker)` pair, and checkpoint advancement commits with
the captured batch.

Replay uses the immutable stored trigger without calling the source again.
Manual resolution records the selected case, actor, and reason.

## Evidence management

Evidence bytes are not stored in PostgreSQL, Kafka, or Fabric.

The upload path is:

```text
Upload stream
  → opaque quarantine object
  → exact-byte SHA-256
  → media detection
  → ClamAV scan
  → canonical object copy
  → canonical size/hash verification
  → AVAILABLE immutable Evidence Version
```

The default local policy accepts PDF, PNG, JPEG, and plain text up to 10 MiB.
The authoritative values are configured by:

```text
EVIDENCE_ALLOWED_MEDIA_TYPES
EVIDENCE_MAX_UPLOAD_BYTES
EVIDENCE_PROCESSING_MAX_ATTEMPTS
EVIDENCE_PROCESSING_LEASE_SECONDS
EVIDENCE_ORPHAN_SAFETY_PERIOD_HOURS
```

Corrections and replacements create a new version linked to the previous version
and previous SHA-256. Controlled downloads are proxied and audited. Integrity
checks re-stream canonical bytes and compare a fresh hash without overwriting
the authoritative hash.

## Validation, review, and approval

Workflow Service uses immutable definition versions and exact Evidence Version
snapshots to drive:

1. evidence and metadata validation;
2. human review tasks;
3. correction cycles;
4. recommendation submission;
5. separate approval or rejection;
6. decision record persistence;
7. Case Service synchronization.

Four-eyes and separation-of-duties controls are enforced in service
transactions, not only in the portal.

## AI assessment and governance

The current adapter is deterministic `MockCortexGateway`. It implements the
governed adapter boundary without inventing a real Cortex API contract.

The service provides:

- controlled runtime profiles and timeout/retry limits;
- model policies and accepted Evidence classifications/media types;
- immutable prompt versions and strict output validation;
- exact pinned Evidence Version citations;
- persisted work queue, retries, cancellation and failure inspection;
- human feedback and controlled acceptance into workflow drafts;
- global processing pause and restoration;
- a fail-closed production boundary for mock execution.

AI output is decision support only. It cannot submit or approve a credit
decision.

## Ledger proofs and Fabric

`ledger-service` is the only application service that imports the Fabric
Gateway SDK or reads the mounted Fabric client identity.

The provider-neutral proof lifecycle is:

```text
Evidence or decision snapshot
  → exact content/canonical hash verification
  → canonical proof envelope
  → durable ProofRequest
  → Fabric submission
  → endorsement and ordering
  → chaincode proof record
  → provider binding and CONFIRMED state
```

Fabric stores proof IDs, evidence/version IDs, opaque organization and case
scope hashes, content/metadata hashes, version lineage, transaction ID, and
transaction timestamp. It does not store evidence bytes, filenames, customer
details, comments, AI output, JWT claims, or human actor details.

Evidence verification reports three independent dimensions:

- off-ledger content hash match;
- ledger proof confirmation;
- ledger content hash match.

Retries reuse the stored canonical envelope and proof ID. The chaincode returns
the existing record for an identical repeated proof and rejects the same proof
ID with a different payload.

## Data ownership and persistence

| Data                                                        | Authoritative storage               |
| ----------------------------------------------------------- | ----------------------------------- |
| Users, roles, permissions and refresh sessions              | Identity PostgreSQL and Redis       |
| Decision cases, parties and assignments                     | Case PostgreSQL                     |
| Connector definitions, triggers and checkpoints             | Integration PostgreSQL              |
| Evidence metadata, versions, scan and access records        | Evidence PostgreSQL                 |
| Evidence file bytes                                         | Garage quarantine/canonical buckets |
| Workflow definitions, tasks, recommendations and decisions  | Workflow PostgreSQL                 |
| Assessments, outputs, governance and operations             | AI PostgreSQL                       |
| Proof requests, provider bindings and verification attempts | Ledger PostgreSQL                   |
| Immutable proof anchors                                     | Hyperledger Fabric ledger           |
| Versioned domain events                                     | Kafka                               |

Application databases and Docker volumes must be backed up using coordinated
platform procedures. Restoring one database does not replace the need to
preserve related object-storage and Fabric state.

## Security controls

- RS256 JWT access tokens and JWKS discovery
- Argon2id password hashing
- Rotating refresh tokens with reuse detection
- Tenant and permission checks at every public service boundary
- Internal service token for controlled service-to-service APIs
- Idempotency keys and optimistic concurrency
- Transactional outbox/inbox event delivery
- Streaming upload limits and content-based media detection
- Quarantine and malware scanning before evidence availability
- Immutable evidence and workflow versions
- Four-eyes approval enforcement
- AI evidence pinning and strict normalized output
- Provider-neutral ledger isolation and on-chain data minimization
- CSP, clickjacking protection, MIME sniffing protection, and restrictive
  browser permission headers

Production deployments must replace local secrets, disable ephemeral signing
keys, use secure cookies and TLS, use managed secret references, restrict
network policies, externalize stateful backups, and operate certificate
rotation and observability.

## Managed/cloud configuration

Images do not change between local and managed deployments. Supply managed
endpoints and credentials through environment variables or secret mounts.

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

Fabric client certificates, private keys, and TLS roots must be mounted
read-only from managed secrets. Never print PEM material, connection profiles,
refresh tokens, passwords, object-storage credentials, or raw provider errors.

## Troubleshooting

### Gateway is not ready

```bash
docker compose --profile local ps
docker compose logs --tail=160 \
  api-gateway identity-access-service case-service evidence-service \
  validation-workflow-service ai-assessment-service ledger-service
```

Readiness remains unavailable until required migrations, seed jobs, storage
bootstrap, and Fabric lifecycle jobs have completed.

### A service repeatedly restarts

```bash
docker compose ps -a
docker compose logs --tail=200 SERVICE_NAME
docker inspect CONTAINER_NAME
```

Check unresolved `.env` placeholders, database credentials, port conflicts,
missing Fabric material, and dependency health.

### Portal is stale after a source change

```bash
docker compose --profile local build cdep-web-portal
docker compose --profile local up -d cdep-web-portal
curl -I http://localhost:8080
```

### Fabric proof submission is unavailable

```bash
docker compose --profile fabric ps
docker compose logs --tail=200 \
  fabric-peer-cdep fabric-peer-audit fabric-orderer fabric-deploy ledger-service
curl -fsS http://localhost:3007/health/ready
```

Existing proof history remains readable from Ledger PostgreSQL during a provider
outage. Provider-dependent verification and submission remain unavailable until
Fabric connectivity is restored.

### Start from a clean local environment

This deletes all local application, evidence, and ledger data:

```bash
docker compose --profile local down -v
docker compose --profile local build
docker compose --profile local up -d
```

## Documentation

- [AI assessment and MockCortex operations](docs/ai-assessment-phase5.md)
- [Evidence architecture and configuration](docs/evidence-management.md)
- [Evidence recovery and orphan reconciliation](docs/evidence-recovery-runbook.md)
- [Integration connectors](docs/integration-connectors.md)
- [Integration cloud and security configuration](docs/integration-cloud-security.md)
- [Workflow operations](docs/workflow-phase4.md)
- [Ledger architecture, Fabric operations and recovery](docs/ledger-phase6.md)
- [Integration OpenAPI](docs/openapi/integration-phase2b.yaml)
- [Evidence OpenAPI](docs/openapi/evidence-phase3.yaml)
- [Workflow OpenAPI](docs/openapi/workflow-phase4.yaml)
- [AI assessment OpenAPI](docs/openapi/ai-assessment-phase5.yaml)
- [Ledger OpenAPI](docs/openapi/ledger-phase6.yaml)
- [Architecture decision records](docs/decisions)

## Operational cautions

- Do not commit `.env`, generated Fabric crypto, database dumps, object-storage
  data, access tokens, or certificates.
- Do not use `docker compose down -v` unless permanent local data removal is
  intended.
- Do not enable `LEDGER_PROVIDER=GCUL`; it is intentionally unavailable.
- Do not enable MockCortex execution as a production AI provider.
- Do not bypass failed tests, four-eyes controls, evidence scanning, or ledger
  verification states.
- Do not overwrite historical evidence versions, workflow definitions, decision
  records, or ledger provider bindings.
