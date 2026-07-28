import assert from "node:assert/strict";

const base = process.env.CDEP_BASE_URL ?? "http://api-gateway:3000";
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const sqlUser = process.env.DEMO_SOURCE_READER;
const sqlPassword = process.env.DEMO_SOURCE_PASSWORD;
assert(
  email && password && sqlUser && sqlPassword,
  "Phase 2B smoke-test environment is incomplete.",
);

async function request(path, { expected = [200], token, ...init } = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body && !(init.body instanceof Uint8Array)
        ? { "content-type": "application/json" }
        : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  assert(
    expected.includes(response.status),
    `${init.method ?? "GET"} ${path}: expected ${expected.join("/")} but received ${response.status}: ${text}`,
  );
  return { response, body };
}

const suffix = `${Date.now()}`;
const login = await request("/api/v1/auth/login", {
  method: "POST",
  expected: [200],
  body: JSON.stringify({ email, password }),
});
const token = login.body.accessToken;
assert(token, "Login did not return an access token.");

await request("/api/v1/integration/sources", { expected: [401] });

const caseReference = `APP-WEB-${suffix}`;
const matchedCase = (
  await request("/api/v1/cases", {
    method: "POST",
    expected: [201],
    token,
    headers: { "idempotency-key": `phase2b-web-case-${suffix}` },
    body: JSON.stringify({
      caseType: "COMMERCIAL_CREDIT",
      title: `Phase 2B webhook case ${suffix}`,
      priority: "NORMAL",
      externalReference: caseReference,
    }),
  })
).body;
const existingSqlCases = (
  await request("/api/v1/cases?search=APP-1001", { token })
).body.items;
const sqlCase =
  existingSqlCases.find((item) => item.externalReference === "APP-1001") ??
  (
    await request("/api/v1/cases", {
      method: "POST",
      expected: [201],
      token,
      headers: { "idempotency-key": `phase2b-sql-case-${suffix}` },
      body: JSON.stringify({
        caseType: "COMMERCIAL_CREDIT",
        title: `Phase 2B SQL case ${suffix}`,
        priority: "NORMAL",
        externalReference: "APP-1001",
      }),
    })
  ).body;

const webhookSource = (
  await request("/api/v1/integration/sources", {
    method: "POST",
    expected: [201],
    token,
    body: JSON.stringify({
      code: `WH${suffix}`,
      name: "Phase 2B opaque webhook source",
    }),
  })
).body;
await request(`/api/v1/integration/sources/${webhookSource.id}/activate`, {
  method: "POST",
  expected: [201],
  token,
  body: "{}",
});
const webhookConnector = (
  await request(`/api/v1/integration/sources/${webhookSource.id}/connectors`, {
    method: "POST",
    expected: [201],
    token,
    body: JSON.stringify({
      name: "Opaque webhook",
      type: "WEBHOOK",
      triggerType: "source.application.updated",
      configuration: { rateLimitPerMinute: 100 },
    }),
  })
).body;
const webhookKey = `phase2b-static-key-${suffix}`;
await request(
  `/api/v1/integration/connectors/${webhookConnector.id}/credentials`,
  {
    method: "PUT",
    expected: [200],
    token,
    body: JSON.stringify({ value: webhookKey }),
  },
);
await request(
  `/api/v1/integration/connectors/${webhookConnector.id}/activate`,
  { method: "POST", expected: [201], token, body: "{}" },
);
const hook = `/api/v1/integration/hooks/${webhookConnector.connectorKey}`;

await request(hook, {
  method: "POST",
  expected: [401],
  headers: { "x-cdep-webhook-key": "invalid-key-value-000" },
  body: JSON.stringify({ any: "shape" }),
});
const arrayReceipt = (
  await request(hook, {
    method: "POST",
    expected: [202],
    headers: { "x-cdep-webhook-key": webhookKey },
    body: JSON.stringify([
      { arbitrary: true },
      { nested: { values: [1, 2, 3] } },
    ]),
  })
).body;
assert.equal(arrayReceipt.status, "RECEIVED");
await request(hook, {
  method: "POST",
  expected: [400],
  headers: {
    "content-type": "application/json",
    "x-cdep-webhook-key": webhookKey,
  },
  body: '{"malformed":',
});
await request(hook, {
  method: "POST",
  expected: [413],
  headers: { "x-cdep-webhook-key": webhookKey },
  body: JSON.stringify({ content: "x".repeat(1_048_576) }),
});

await request(
  `/api/v1/integration/connectors/${webhookConnector.id}/extraction-rules`,
  {
    method: "PUT",
    expected: [200],
    token,
    body: JSON.stringify({
      rules: [
        {
          targetField: "businessReference",
          sourcePath: "$.application.reference",
          required: true,
          transform: "TRIM",
        },
        {
          targetField: "subjectId",
          sourcePath: "$.customer.id",
          required: false,
          transform: "STRING",
        },
      ],
    }),
  },
);
await request(
  `/api/v1/integration/connectors/${webhookConnector.id}/correlation-rules`,
  {
    method: "PUT",
    expected: [200],
    token,
    body: JSON.stringify({
      name: "Business reference match",
      ruleType: "BUSINESS_REFERENCE_EQUALS",
    }),
  },
);
const objectBytes = JSON.stringify({
  application: { reference: caseReference },
  customer: { id: `CUS-${suffix}` },
  sourceSpecific: { decision: "REFERRED", reasons: ["manual-review"] },
});
const firstReceipt = (
  await request(hook, {
    method: "POST",
    expected: [202],
    headers: {
      "x-cdep-webhook-key": webhookKey,
      "x-source-event-id": `event-${suffix}`,
    },
    body: objectBytes,
  })
).body;
const duplicateReceipt = (
  await request(hook, {
    method: "POST",
    expected: [202],
    headers: {
      "x-cdep-webhook-key": webhookKey,
      "x-source-event-id": `event-${suffix}`,
    },
    body: objectBytes,
  })
).body;
assert.equal(duplicateReceipt.receiptId, firstReceipt.receiptId);
await request(hook, {
  method: "POST",
  expected: [409],
  headers: {
    "x-cdep-webhook-key": webhookKey,
    "x-source-event-id": `event-${suffix}`,
  },
  body: JSON.stringify({ application: { reference: "CHANGED" } }),
});
const matchedTrigger = (
  await request(`/api/v1/integration/triggers/${firstReceipt.receiptId}`, {
    token,
  })
).body;
assert.equal(matchedTrigger.triggerType, "source.application.updated");
assert.equal(matchedTrigger.caseId, matchedCase.id);
assert(["READY", "PUBLISHED"].includes(matchedTrigger.status));

const failedReceipt = (
  await request(hook, {
    method: "POST",
    expected: [202],
    headers: {
      "x-cdep-webhook-key": webhookKey,
      "x-source-event-id": `missing-${suffix}`,
    },
    body: JSON.stringify({ unrelated: { value: true } }),
  })
).body;
const failedTrigger = (
  await request(`/api/v1/integration/triggers/${failedReceipt.receiptId}`, {
    token,
  })
).body;
assert.equal(failedTrigger.status, "EXTRACTION_FAILED");
await request(
  `/api/v1/integration/triggers/${failedReceipt.receiptId}/replay`,
  {
    method: "POST",
    expected: [201],
    token,
    headers: { "idempotency-key": `replay-${suffix}` },
    body: JSON.stringify({
      reason: "Verify deterministic replay of a visible extraction failure",
    }),
  },
);

const sqlSource = (
  await request("/api/v1/integration/sources", {
    method: "POST",
    expected: [201],
    token,
    body: JSON.stringify({
      code: `SQL${suffix}`,
      name: "Phase 2B PostgreSQL source",
    }),
  })
).body;
await request(`/api/v1/integration/sources/${sqlSource.id}/activate`, {
  method: "POST",
  expected: [201],
  token,
  body: "{}",
});
const sqlConnector = (
  await request(`/api/v1/integration/sources/${sqlSource.id}/connectors`, {
    method: "POST",
    expected: [201],
    token,
    body: JSON.stringify({
      name: "Read-only application polling",
      type: "SQL_POLL",
      triggerType: "source.application.polled",
      configuration: {
        engine: "POSTGRESQL",
        host: "integration-demo-postgres",
        port: 5432,
        database: "cdep_source_demo",
        sslMode: "DISABLE",
        schema: "public",
        tableOrView: "source_applications",
        selectedColumns: [
          "application_reference",
          "customer_reference",
          "status",
          "requested_amount",
        ],
        watermarkColumn: "updated_at",
        watermarkType: "TIMESTAMP",
        tieBreakerColumn: "id",
        tieBreakerType: "UUID",
        sourceRecordIdColumn: "id",
        occurredAtColumn: "updated_at",
        pollIntervalSeconds: 3600,
        batchSize: 2,
        statementTimeoutMs: 5000,
        initialLookbackMinutes: 10080,
      },
    }),
  })
).body;
await request(`/api/v1/integration/connectors/${sqlConnector.id}/credentials`, {
  method: "PUT",
  expected: [200],
  token,
  body: JSON.stringify({
    value: JSON.stringify({ username: sqlUser, password: sqlPassword }),
  }),
});
const connection = (
  await request(`/api/v1/integration/connectors/${sqlConnector.id}/test`, {
    method: "POST",
    expected: [201],
    token,
    body: "{}",
  })
).body;
assert.equal(connection.ok, true);
await request(
  `/api/v1/integration/connectors/${sqlConnector.id}/extraction-rules`,
  {
    method: "PUT",
    expected: [200],
    token,
    body: JSON.stringify({
      rules: [
        {
          targetField: "businessReference",
          sourcePath: "$.application_reference",
          required: true,
          transform: "TRIM",
        },
      ],
    }),
  },
);
await request(
  `/api/v1/integration/connectors/${sqlConnector.id}/correlation-rules`,
  {
    method: "PUT",
    expected: [200],
    token,
    body: JSON.stringify({ ruleType: "BUSINESS_REFERENCE_EQUALS" }),
  },
);
await request(`/api/v1/integration/connectors/${sqlConnector.id}/activate`, {
  method: "POST",
  expected: [201],
  token,
  body: "{}",
});
await request(`/api/v1/integration/connectors/${sqlConnector.id}/run`, {
  method: "POST",
  expected: [201],
  token,
  headers: { "idempotency-key": `sql-run-1-${suffix}` },
  body: "{}",
});
await request(`/api/v1/integration/connectors/${sqlConnector.id}/run`, {
  method: "POST",
  expected: [201],
  token,
  headers: { "idempotency-key": `sql-run-2-${suffix}` },
  body: "{}",
});

const sqlTriggers = (
  await request(
    `/api/v1/integration/triggers?connectorId=${sqlConnector.id}&limit=20`,
    { token },
  )
).body;
assert.equal(
  sqlTriggers.length,
  3,
  "SQL polling must capture all three rows exactly once.",
);
assert.equal(new Set(sqlTriggers.map((item) => item.sourceRecordId)).size, 3);
assert(
  sqlTriggers.every((item) => item.triggerType === "source.application.polled"),
);
assert(sqlTriggers.some((item) => item.caseId === sqlCase.id));
const sqlRuns = (
  await request(`/api/v1/integration/runs?connectorId=${sqlConnector.id}`, {
    token,
  })
).body;
assert(sqlRuns.length >= 2);
assert(sqlRuns.some((run) => run.rowsCaptured === 2));
assert(sqlRuns.some((run) => run.rowsCaptured === 1));
const finalCheckpoint = sqlRuns.find(
  (run) =>
    run.checkpointAfter?.tieBreaker === "00000000-0000-0000-0000-000000000003",
);
assert(
  finalCheckpoint,
  "The final SQL checkpoint was not advanced to the last tie-breaker.",
);

const unresolved = sqlTriggers.find(
  (item) => item.status === "UNMATCHED" && item.sourceRecordId.endsWith("2"),
);
assert(unresolved, "Expected the second SQL record to be unmatched.");
const resolved = (
  await request(`/api/v1/integration/triggers/${unresolved.id}/resolve-case`, {
    method: "POST",
    expected: [201],
    token,
    body: JSON.stringify({
      caseId: matchedCase.id,
      reason: "Validated manual Phase 2B correlation",
    }),
  })
).body;
assert.equal(resolved.caseId, matchedCase.id);
const journey = (
  await request(`/api/v1/integration/cases/${matchedCase.id}/journey`, {
    token,
  })
).body;
assert(
  journey.some((event) => event.sourceTriggerId === firstReceipt.receiptId),
);
assert(journey.some((event) => event.sourceTriggerId === unresolved.id));

console.log(
  JSON.stringify(
    {
      result: "PASS",
      webhook: {
        connectorKey: webhookConnector.connectorKey,
        arbitraryArrayReceipt: arrayReceipt.receiptId,
        idempotentReceipt: firstReceipt.receiptId,
        matchedCaseId: matchedCase.id,
        extractionFailureId: failedReceipt.receiptId,
      },
      sql: {
        connectorId: sqlConnector.id,
        capturedSourceRecords: sqlTriggers
          .map((item) => item.sourceRecordId)
          .sort(),
        successfulRuns: sqlRuns.filter((run) => run.status === "SUCCEEDED")
          .length,
        finalCheckpoint: finalCheckpoint.checkpointAfter,
      },
      journeyEvents: journey.length,
    },
    null,
    2,
  ),
);
