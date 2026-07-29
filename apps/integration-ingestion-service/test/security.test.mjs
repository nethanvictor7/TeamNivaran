import assert from "node:assert/strict";
import test from "node:test";

process.env.PORT = "3003";
process.env.DATABASE_URL = "postgresql://unused:unused@localhost/unused";
process.env.JWT_JWKS_URL = "http://localhost/jwks";
process.env.JWT_ISSUER = "test";
process.env.JWT_AUDIENCE = "test";
process.env.CASE_SERVICE_URL = "http://localhost:3002";
process.env.KAFKA_BROKERS = "localhost:9092";
process.env.CONNECTOR_SECRET_PROVIDER = "local";
process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY =
  "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";
process.env.CONNECTOR_CREDENTIAL_KEY_ID = "test-key";
process.env.INTERNAL_SERVICE_TOKEN = "test-internal-service-token-value-123";
process.env.SQL_POLL_DEFAULT_BATCH_SIZE = "100";
process.env.SQL_POLL_MAX_BATCH_SIZE = "1000";
process.env.SQL_POLL_MAX_INITIAL_LOOKBACK_MINUTES = "10080";
process.env.SQL_POLL_LEASE_SECONDS = "60";
process.env.SQL_POLL_FAILURE_PAUSE_THRESHOLD = "5";

test("local credential encryption round-trips and rejects tampering", async () => {
  const { SecretProtector } = await import("../dist/src/secret-protector.js");
  const protector = new SecretProtector();
  const encrypted = protector.encrypt("connector-secret-value");
  assert.equal(protector.decrypt(encrypted), "connector-secret-value");
  encrypted.authTag[0] ^= 1;
  assert.throws(() => protector.decrypt(encrypted));
});

test("PostgreSQL configuration rejects unsafe identifiers and arbitrary SQL fields", async () => {
  const { PostgresSqlPollingAdapter } =
    await import("../dist/src/sql-polling.adapter.js");
  const adapter = new PostgresSqlPollingAdapter();
  const base = {
    engine: "POSTGRESQL",
    host: "source",
    port: 5432,
    database: "source",
    sslMode: "DISABLE",
    schema: "public",
    tableOrView: "applications",
    selectedColumns: ["status"],
    watermarkColumn: "updated_at",
    watermarkType: "TIMESTAMP",
    tieBreakerColumn: "id",
    tieBreakerType: "UUID",
    sourceRecordIdColumn: "id",
    pollIntervalSeconds: 30,
    batchSize: 100,
    statementTimeoutMs: 5000,
    initialLookbackMinutes: 60,
  };
  assert.equal(adapter.validateConfiguration(base).tableOrView, "applications");
  assert.throws(() =>
    adapter.validateConfiguration({
      ...base,
      tableOrView: "applications; DROP TABLE x",
    }),
  );
  assert.throws(() =>
    adapter.validateConfiguration({
      ...base,
      sql: "SELECT * FROM applications",
    }),
  );
});

test("PostgreSQL polling selects only configured fields and advances a timestamp/tie-breaker checkpoint", async () => {
  const { PostgresSqlPollingAdapter } =
    await import("../dist/src/sql-polling.adapter.js");
  const adapter = new PostgresSqlPollingAdapter();
  const observed = [];
  adapter.pool = () => ({
    query: async (sql, parameters) => {
      observed.push({ sql, parameters });
      return {
        rows: [
          {
            status: "REFERRED",
            updated_at: new Date("2026-07-23T08:00:00Z"),
            id: "00000000-0000-0000-0000-000000000002",
          },
        ],
      };
    },
    end: async () => {},
  });
  const configuration = adapter.validateConfiguration({
    engine: "POSTGRESQL",
    host: "source",
    port: 5432,
    database: "source",
    sslMode: "DISABLE",
    schema: "public",
    tableOrView: "applications",
    selectedColumns: ["status"],
    watermarkColumn: "updated_at",
    watermarkType: "TIMESTAMP",
    tieBreakerColumn: "id",
    tieBreakerType: "UUID",
    sourceRecordIdColumn: "id",
    occurredAtColumn: "updated_at",
    pollIntervalSeconds: 30,
    batchSize: 1,
    statementTimeoutMs: 5000,
    initialLookbackMinutes: 60,
  });
  const result = await adapter.poll(
    configuration,
    { username: "reader", password: "secret" },
    {
      watermark: "2026-07-23T08:00:00.000Z",
      tieBreaker: "00000000-0000-0000-0000-000000000001",
    },
  );
  assert.match(
    observed[0].sql,
    /^SELECT "status", "updated_at", "id" FROM "public"."applications"/,
  );
  assert.doesNotMatch(observed[0].sql, /\*/);
  assert.doesNotMatch(observed[0].sql, /customer_name/);
  assert.equal(
    observed[0].parameters[1],
    "00000000-0000-0000-0000-000000000001",
  );
  assert.deepEqual(Object.keys(result.rows[0].payload).sort(), [
    "id",
    "status",
    "updated_at",
  ]);
  assert.deepEqual(result.nextCheckpoint, {
    watermark: "2026-07-23T08:00:00.000Z",
    tieBreaker: "00000000-0000-0000-0000-000000000002",
  });
  assert(
    observed.every(({ sql }) => sql.startsWith("SELECT ")),
    "Polling must execute only SELECT statements.",
  );
});

test("PostgreSQL connection tests require a read-only source account", async () => {
  const { PostgresSqlPollingAdapter } =
    await import("../dist/src/sql-polling.adapter.js");
  const adapter = new PostgresSqlPollingAdapter();
  adapter.pool = () => ({
    query: async (sql) => {
      assert.equal(sql, "SHOW transaction_read_only");
      return { rows: [{ transaction_read_only: "off" }] };
    },
    end: async () => {},
  });
  const configuration = adapter.validateConfiguration({
    engine: "POSTGRESQL",
    host: "source",
    port: 5432,
    database: "source",
    sslMode: "DISABLE",
    schema: "public",
    tableOrView: "applications",
    selectedColumns: ["status"],
    watermarkColumn: "updated_at",
    watermarkType: "TIMESTAMP",
    tieBreakerColumn: "id",
    tieBreakerType: "UUID",
    sourceRecordIdColumn: "id",
    pollIntervalSeconds: 30,
    batchSize: 100,
    statementTimeoutMs: 5000,
    initialLookbackMinutes: 60,
  });
  await assert.rejects(() =>
    adapter.testConnection(configuration, {
      username: "writer",
      password: "secret",
    }),
  );
});
