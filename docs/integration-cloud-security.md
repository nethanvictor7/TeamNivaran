# Integration cloud and security configuration

The local and cloud deployments use the same application images. Deployment
changes only environment endpoints, TLS/security settings, and secret delivery.
Use Docker DNS locally and managed PostgreSQL, Kafka, JWKS, and Case Service
endpoints in cloud environments.

Required integration settings include `INTEGRATION_DATABASE_URL`,
`KAFKA_BROKERS`, `KAFKA_SECURITY_PROTOCOL`, `JWKS_URL`, `JWT_ISSUER`,
`JWT_AUDIENCE`, `CONNECTOR_SECRET_PROVIDER`,
`CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, `WEBHOOK_MAX_BODY_BYTES`, and all
`SQL_POLL_*` limits shown in `.env.example`.

Local connector credentials use AES-256-GCM with a unique nonce and runtime
key. The database stores ciphertext and rotation metadata. With
`CONNECTOR_SECRET_PROVIDER=external`, the credential API accepts a
`file:/run/secrets/<name>` reference and the runtime reads the mounted secret
file without storing its value. A cloud secret manager/CSI driver can populate
that path. Neither source credentials nor keys belong in Compose, images, source
control, logs, or browser-readable configuration.

The gateway and integration service validate access independently. Public
webhooks are separated from JWT administration routes, use a constant-time
connector key comparison, have gateway and connector rate limits, and enforce
the configured body limit. Structured request logging redacts authorization,
cookies, webhook keys, bodies, payloads, and credential fields.

SQL configuration accepts no arbitrary query text. Source users must be
read-only and should receive only database `CONNECT`, schema `USAGE`, and
table/view `SELECT`. Polling uses bounded pools, connection/statement timeouts,
validated identifiers, bound checkpoint values, batch limits, lookback limits,
and a database lease.

Integration Service calls Case Service through the authenticated internal
correlation API. It never queries the Case database. Organization-owned
administration, trigger, run, payload, replay, resolution, and journey reads are
tenant scoped.

> Phase 2B accepts opaque inbound webhook JSON and polls configured PostgreSQL
> tables/views. It does not define webhook payload schemas, customize webhook
> responses, accept arbitrary SQL, or automatically understand source business
> semantics.
