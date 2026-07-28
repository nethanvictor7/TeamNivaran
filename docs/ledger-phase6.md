# Phase 6 ledger proofs

## Architecture and ownership

`ledger-service` is the sole proof orchestrator and ledger client. Evidence and
Workflow remain authoritative for their own records and expose controlled
internal proof snapshots. Case, Evidence, Workflow, AI Assessment, Gateway, and
the portal do not import Fabric code. Canonical proof envelopes and database/API
models are provider-neutral.

`LedgerProvider` normalizes submission, query, verification, retryability, and
conflicts into `ACCEPTED`, `PENDING_FINALITY`, `FINALIZED`, `REJECTED`,
`NOT_FOUND`, or `UNAVAILABLE`. CDEP proof IDs are independent of provider
transaction IDs. The persisted binding contains provider type and opaque
transaction, proof, contract, and network references plus metadata schema
version.

Fabric Gateway SDK, channel/chaincode/MSP settings, service certificate/private
key access, deadlines, and error translation are confined to
`apps/ledger-service/src/fabric-ledger-provider.ts`. Human users continue to use
JWTs; the off-ledger records retain their stable actor IDs.

## Canonical proof schemas

Canonical JSON recursively sorts object keys, preserves array order, emits no
insignificant whitespace, and hashes UTF-8 bytes with SHA-256. Node and Go tests
share the vector:

```text
input:  {"z":"last","a":[2,"x"],"nested":{"b":true,"a":null}}
bytes:  {"a":[2,"x"],"nested":{"a":null,"b":true},"z":"last"}
sha256: f00fd09a06465684b90b07fe3dba58e7a0faab663d087ea7d6362b80acb5e645
```

Evidence proofs contain only `proofId`, organization/case scope hashes,
immutable evidence and version IDs, content/metadata SHA-256, optional
`previousProofId`, and schema version. Decision proofs contain the proof/case
scope, workflow and decision IDs, terminal outcome, and canonical hashes for the
evidence manifest, recommendation, and decision record. Chaincode adds the
transaction timestamp and transaction ID. Strict decoding rejects every
unrecognized field.

## Local Fabric network

The Compose `fabric` profile provides:

- CDEP and Audit Fabric CAs;
- `peer0.cdep.example.com` and `peer0.audit.example.com`;
- one channel-participation orderer using Raft;
- LevelDB peer state;
- `cdep-proof-channel`;
- `cdep-proof-registry` Go chaincode;
- an `AND('CDEPMSP.peer','AuditMSP.peer')` endorsement policy;
- an idempotent deployment job that creates the channel, joins both peers, and
  packages, installs, approves, checks, and commits chaincode.

Local generated MSP, TLS, channel, and ledger material is held in named volumes,
not the repository or images. The peer-embedded Gateway is used; no separate
Gateway container exists.

```bash
docker compose --profile fabric up -d
docker compose --profile local up -d
docker compose ps
CDEP_BASE_URL=http://localhost:3000 npm run validate:phase6
```

The Fabric lifecycle job is safe to rerun. It detects existing channel joins,
installed package IDs, organization approvals, and committed definitions.

## API, permissions, and events

The provider-neutral API is documented in
[`openapi/ledger-phase6.yaml`](openapi/ledger-phase6.yaml). Proof creation
requires `proof:create`; read and verification use `proof:read` and
`proof:verify`; operators receive `proof:retry`; status and reconciliation use
`ledger:status:read` and `ledger:reconcile`. Auditors have read/verify access
without create/retry privileges.

The service idempotently consumes `evidence.available`, `decision.approved`, and
`decision.rejected`. Consumption records eligible events but does not auto-anchor
unless an organization policy is later enabled. Transactional outbox publishing
emits `proof.requested`, `proof.submitted`, `proof.confirmed`, `proof.failed`,
`proof.verification.completed`, and `decision-proof.confirmed` to
`cdep.ledger.proof.v1`, `cdep.ledger.verification.v1`, and
`cdep.ledger.dlt.v1`. Payloads use only safe hashes, correlation data, provider
type, and opaque references.

## Operations, recovery, and monitoring

Monitor:

- `/health/live`, `/health/startup`, and `/health/ready`;
- `/api/v1/ledger/network/status`;
- proof-request age by state and attempt count;
- retryable/permanent failures and safe error codes;
- worker lease expiry, outbox lag, inbox conflicts, and reconciliation counts;
- peer/orderer operation endpoints and chaincode container health.

If a process exits before submission, its lease expires and another worker
submits the same proof. If finality is ambiguous, the transaction/binding is
queried and reconciliation confirms it without changing the proof ID. Run
`POST /api/v1/ledger/reconciliation/run` with operator permission after restoring
provider reachability. Manual retry is allowed only for failure states and
always resubmits the stored canonical envelope.

Back up each application database and Fabric peer/orderer volumes using
coordinated platform procedures. Never restore one peer as a replacement for
the application database. Preserve certificate trust chains and historical
provider configuration for verification. Rotate the service identity with
overlap: mount the replacement secret, validate its MSP authorization, restart
`ledger-service`, verify readiness/submission, then revoke the old identity.
Never print PEM, private key, connection profile, or raw Fabric errors.

## Cloud and Kubernetes configuration

Use managed secret references/CSI volumes for the Fabric client certificate,
private key, and TLS trust root. Mount them read-only with a non-root UID and
restrict network policy to the selected Gateway peer. Supply database, Kafka,
Evidence, Workflow, and Fabric endpoints through deployment configuration.
Externalize peer/orderer persistence, backups, CA operations, observability,
certificate renewal, DNS, and mTLS according to the platform control plane.

Readiness requires PostgreSQL and a usable provider connection, but Gateway
liveness does not enumerate or require every Fabric peer. Scale workers with the
database lease; retain an appropriate connection limit and use disruption
budgets so reconciliation remains available.

## Provider cutover

Do not set `LEDGER_PROVIDER=GCUL` today; startup fails by design. Once the
authoritative GCUL SDK/protobuf, account/signing, contract, and finality contract
are supplied:

1. implement `GculLedgerProvider` entirely behind `LedgerProvider`;
2. run the same canonical/provider contract suite and real GCUL E2E tests;
3. deploy both Fabric and GCUL adapters so historical Fabric bindings remain
   readable;
4. configure an explicit organization policy and effective timestamp for new
   proofs;
5. change the active provider for new anchors only;
6. if re-anchoring is approved, create a new linked proof—never overwrite an
   existing Fabric binding;
7. monitor and roll back new submissions without altering historical anchors.

The cutover must not modify canonical proof schemas, public routes, shared event
schemas, upstream services, or portal components.

## Phase 6.1 case UI integration

The API Gateway explicitly routes and validates
`GET /api/v1/cases/:caseId/ledger-summary` and
`GET /api/v1/cases/:caseId/proofs`. The ledger service verifies case access
against the Case Service, joins the Evidence Service's current immutable case
snapshot to Phase 6 proof records, and returns safe provider-neutral
presentation contracts. Proof history uses an HMAC-protected cursor bound to
the organization, case, page size, and filters. It never queries Fabric once
per row.

The portal exposes `/cases/:caseId/:section` routes, including the directly
addressable `ledger` section. Browser back/forward, a direct refresh, and legacy
Phase 6.1 hash links resolve to the same case and tab. Inactive tabs are
unmounted, so opening Overview no longer issues evidence, workflow, AI,
timeline, journey, and proof-list requests.

Overview and workflow load the case summary only. Evidence loads the summary
plus the case-scoped proof projection. Ledger and activity load paginated
proofs as required. All responses are runtime-validated with the shared
provider-neutral schemas and obsolete requests receive an abort signal.
Filtered proof history is server-side rather than filtering only the already
loaded cursor page.

Only `FAILED_RETRYABLE` requests offer retry; confirmation is required.
Auditors can read and verify but cannot anchor or retry. A user without
`proof:read` sees a safe denial and the proof queries remain disabled. When the
configured provider is unavailable, existing proof records and transaction
references remain visible while provider-dependent actions explain why they
are disabled.

The UI distinguishes `Not eligible`, `Eligible — not yet anchored`,
`No proof found`, `Ledger temporarily unavailable`, and `Verification
mismatch`. Drawers and confirmation dialogs trap focus, close with Escape, and
restore focus. Copying a reference copies the complete safe value and announces
success or failure. Pending states use bounded exponential polling while the
Ledger tab is active and stop on a terminal state, route change, abort, or the
two-minute limit.

`npm run validate:phase6.1` is the unattended V2 entry point. It validates and
starts Compose, rebuilds affected images, waits for readiness, runs portal
typecheck/tests/build, verifies deep-link fallback, and runs the Phase 6 plus
6.1 validator against real local Fabric. `npm run validate:phase6.1:api` retains
the inner API scenario for use inside the Compose network.
