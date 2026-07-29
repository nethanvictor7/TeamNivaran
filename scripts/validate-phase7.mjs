import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Kafka } from "kafkajs";

function parseEnvironment(value) {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index);
        let item = line.slice(index + 1).trim();
        if (
          (item.startsWith('"') && item.endsWith('"')) ||
          (item.startsWith("'") && item.endsWith("'"))
        )
          item = item.slice(1, -1);
        return [key, item];
      }),
  );
}

const environment = parseEnvironment(await readFile(".env", "utf8"));
const gateway = process.env.CDEP_GATEWAY_URL ?? "http://localhost:3000";
const password =
  process.env.BOOTSTRAP_ADMIN_PASSWORD ?? environment.BOOTSTRAP_ADMIN_PASSWORD;
assert(
  password,
  "BOOTSTRAP_ADMIN_PASSWORD is required in the local environment.",
);

async function login(email) {
  const response = await fetch(`${gateway}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(
    response.status,
    200,
    `Login failed for the Phase 7 role ${email}.`,
  );
  return response.json();
}

const admin = await login(
  environment.BOOTSTRAP_ADMIN_EMAIL ?? "admin@cdep.local",
);
const auditor = await login(
  environment.BOOTSTRAP_AUDITOR_EMAIL ?? "auditor@cdep.local",
);
const outsider = await login(
  environment.BOOTSTRAP_OUTSIDER_EMAIL ?? "outsider@cdep.local",
);

async function request(path, options = {}, principal = admin) {
  const response = await fetch(`${gateway}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      authorization: `Bearer ${principal.accessToken}`,
    },
  });
  return response;
}

async function json(path, options = {}, expected = 200, principal = admin) {
  const response = await request(path, options, principal);
  const body = await response.json().catch(() => null);
  assert.equal(
    response.status,
    expected,
    `${options.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
}

async function poll(path, accepted, principal = admin) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await json(path, {}, 200, principal);
    if (accepted.includes(result.state)) return result;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

const gatewayHealth = await json("/health/ready");
assert.equal(gatewayHealth.status, "ok");
assert.equal(gatewayHealth.dependencies.auditQueryService, "up");
assert.equal((await fetch(`${gateway}/api/v1/audit/records`)).status, 401);
assert.equal(
  (
    await request(
      "/api/v1/audit/records",
      { headers: { "x-organization-id": outsider.identity.organizationId } },
      outsider,
    )
  ).status,
  403,
);

const kafka = new Kafka({
  clientId: "cdep-phase7-validator",
  brokers: [process.env.KAFKA_BROKER ?? "localhost:29092"],
  retry: { retries: 5 },
});
const producer = kafka.producer();
await producer.connect();
const eventId = randomUUID();
const aggregateId = randomUUID();
const now = new Date().toISOString();
const event = {
  eventId,
  eventType: "audit.validator.synthetic.completed",
  eventVersion: "1.0",
  occurredAt: now,
  correlationId: randomUUID(),
  causationId: null,
  producer: "phase7-validator",
  organizationId: admin.identity.organizationId,
  actor: { type: "SYSTEM", id: "phase7-validator" },
  aggregate: { type: "AuditValidation", id: aggregateId, version: 1 },
  payload: {
    caseId: aggregateId,
    password: "must-be-redacted",
    validation: "duplicate-and-redaction",
  },
};
const lateEvent = {
  ...event,
  eventId: randomUUID(),
  eventType: "audit.validator.late.completed",
  occurredAt: "2020-01-01T00:00:00.000Z",
  correlationId: randomUUID(),
  aggregate: { ...event.aggregate, id: randomUUID() },
};
await producer.send({
  topic: "cdep.case.v1",
  messages: [
    { key: event.eventId, value: JSON.stringify(event) },
    { key: event.eventId, value: JSON.stringify(event) },
    { key: lateEvent.eventId, value: JSON.stringify(lateEvent) },
    { key: randomUUID(), value: "{invalid-json" },
  ],
});
await producer.disconnect();

let projected;
const projectionDeadline = Date.now() + 20_000;
while (Date.now() < projectionDeadline) {
  projected = await json(
    `/api/v1/audit/records?eventType=${encodeURIComponent(event.eventType)}&pageSize=10`,
  );
  if (projected.items.some((item) => item.eventId === eventId)) break;
  await new Promise((resolve) => setTimeout(resolve, 300));
}
const projectedEvent = projected.items.filter(
  (item) => item.eventId === eventId,
);
assert.equal(
  projectedEvent.length,
  1,
  "Synthetic event was not projected exactly once.",
);
assert.equal(projectedEvent[0].metadata.password, undefined);
assert.equal(projectedEvent[0].organizationId, admin.identity.organizationId);

const late = await json(
  `/api/v1/audit/records?eventType=${encodeURIComponent(lateEvent.eventType)}&pageSize=10`,
);
const projectedLate = late.items.filter(
  (item) => item.eventId === lateEvent.eventId,
);
assert.equal(projectedLate.length, 1);
assert.equal(projectedLate[0].lateArrival, true);

const firstPage = await json("/api/v1/audit/records?pageSize=1");
assert.equal(firstPage.items.length, 1);
assert(
  firstPage.nextCursor,
  "A populated audit authority must return a cursor.",
);
assert.equal(
  (
    await request(
      `/api/v1/audit/records?pageSize=1&outcome=SUCCESS&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    )
  ).status,
  400,
  "A cursor must be rejected when its bound filters change.",
);

const journey = await json(`/api/v1/audit/cases/${aggregateId}/journey`);
assert(
  journey.items.some((item) => item.eventId === eventId),
  "The server-composed journey did not include the case-scoped event.",
);
const chain = await json("/api/v1/audit/chain/verify?limit=5000");
assert.equal(chain.status, "VERIFIED");

const reportBody = {
  reportKey: "CASE_DECISION_DOSSIER",
  parameters: { caseId: aggregateId },
};
const reportKey = `phase7-report-${randomUUID()}`;
const report = await json(
  "/api/v1/audit/reports",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": reportKey,
    },
    body: JSON.stringify(reportBody),
  },
  202,
);
const reportDuplicate = await json(
  "/api/v1/audit/reports",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": reportKey,
    },
    body: JSON.stringify(reportBody),
  },
  202,
);
assert.equal(reportDuplicate.id, report.id);
assert.equal(
  (
    await request("/api/v1/audit/reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": reportKey,
      },
      body: JSON.stringify({
        reportKey: "OPERATIONAL_AUDIT_ACTIVITY",
        parameters: {},
      }),
    })
  ).status,
  409,
);
const completedReport = await poll(`/api/v1/audit/reports/${report.id}`, [
  "COMPLETED",
  "FAILED",
]);
assert.equal(completedReport.state, "COMPLETED");
assert(completedReport.checksumSha256);
const reportGrant = await json(`/api/v1/audit/reports/${report.id}/download`);
assert.equal(
  (await request(`/api/v1/audit/reports/${report.id}/download`, {}, outsider))
    .status,
  403,
);
const reportArtifact = Buffer.from(
  await (await fetch(reportGrant.url)).arrayBuffer(),
);
assert.equal(
  createHash("sha256").update(reportArtifact).digest("hex"),
  completedReport.checksumSha256,
);

const exportResults = [];
for (const format of ["CSV", "JSON"]) {
  const run = await json(
    "/api/v1/audit/exports",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `phase7-export-${format}-${randomUUID()}`,
      },
      body: JSON.stringify({
        format,
        filters: { resourceId: aggregateId },
      }),
    },
    202,
  );
  const completed = await poll(`/api/v1/audit/exports/${run.id}`, [
    "COMPLETED",
    "FAILED",
  ]);
  assert.equal(completed.state, "COMPLETED");
  const grant = await json(`/api/v1/audit/exports/${run.id}/download`);
  const artifact = Buffer.from(await (await fetch(grant.url)).arrayBuffer());
  assert.equal(
    createHash("sha256").update(artifact).digest("hex"),
    completed.checksumSha256,
  );
  if (format === "CSV")
    assert(
      artifact
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .startsWith('"audit_id","occurred_at"'),
    );
  else assert.equal(JSON.parse(artifact.toString("utf8")).rowCount, 1);
  exportResults.push(completed);
}

const auditorSearch = await json(
  `/api/v1/audit/records?eventType=${encodeURIComponent(event.eventType)}`,
  {},
  200,
  auditor,
);
assert.equal(
  auditorSearch.items.filter((item) => item.eventId === eventId).length,
  1,
);
assert(
  auditorSearch.items.every(
    (item) => item.organizationId === auditor.identity.organizationId,
  ),
);

const operation = await json(
  "/api/v1/audit/operations",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `phase7-operation-${randomUUID()}`,
    },
    body: JSON.stringify({
      type: "RECONCILIATION",
      reason: "Phase 7 bounded reconciliation acceptance validation.",
      dryRun: true,
      parameters: {},
    }),
  },
  202,
);
let operations;
const operationDeadline = Date.now() + 20_000;
while (Date.now() < operationDeadline) {
  operations = await json("/api/v1/audit/operations");
  const current = operations.jobs.find((item) => item.id === operation.id);
  if (current && ["COMPLETED", "FAILED"].includes(current.state)) {
    assert.equal(current.state, "COMPLETED");
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
assert(
  operations.jobs.some(
    (item) => item.id === operation.id && item.state === "COMPLETED",
  ),
);
assert(operations.quarantineOpen >= 1, "Poison events must be quarantined.");
const finalChain = await json("/api/v1/audit/chain/verify?limit=5000");
assert.equal(
  finalChain.status,
  "VERIFIED",
  "Audit control actions must preserve the append-only tenant hash chain.",
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      gateway: gatewayHealth.status,
      auditRecordsChecked: finalChain.checked,
      duplicateProjectionCount: projectedEvent.length,
      journeyEvents: journey.items.length,
      reportRows: completedReport.rowCount,
      exportFormats: exportResults.map((item) => item.format),
      chain: finalChain.status,
      reconciliation: "COMPLETED",
      quarantineObserved: operations.quarantineOpen,
    },
    null,
    2,
  ),
);
