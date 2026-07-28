import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = process.env.CDEP_BASE_URL ?? "http://api-gateway:3000";
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
assert(email && password, "Phase 3 validator credentials are incomplete.");

async function request(
  path,
  { expected = [200], token, json, body, headers = {}, ...init } = {},
) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    body: json === undefined ? body : JSON.stringify(json),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const responseBody = contentType.includes("json")
    ? await response.json()
    : await response.arrayBuffer();
  assert(
    expected.includes(response.status),
    `${init.method ?? "GET"} ${path}: expected ${expected.join("/")} but received ${response.status}: ${
      responseBody instanceof ArrayBuffer
        ? `<${responseBody.byteLength} bytes>`
        : JSON.stringify(responseBody)
    }`,
  );
  return { response, body: responseBody };
}

async function waitFor(description, operation, predicate, timeoutMs = 180_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    `${description} did not complete within ${timeoutMs}ms; last result: ${JSON.stringify(last)}`,
  );
}

function uploadForm({
  bytes,
  filename,
  title,
  classificationCode = "BANK_STATEMENT",
  reason = "INITIAL",
}) {
  const form = new FormData();
  form.append("classificationCode", classificationCode);
  form.append("title", title);
  form.append("description", "Phase 3 Docker validation fixture");
  form.append("declaredSizeBytes", String(bytes.byteLength));
  form.append("reason", reason);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  return form;
}

const suffix = String(Date.now());
const login = await request("/api/v1/auth/login", {
  method: "POST",
  json: { email, password },
});
const token = login.body.accessToken;
assert(token, "Login did not return an access token.");

await request("/api/v1/evidence/classifications", {
  expected: [401],
});
const decisionCase = (
  await request("/api/v1/cases", {
    method: "POST",
    expected: [201],
    token,
    headers: { "idempotency-key": `phase3-case-${suffix}` },
    json: {
      caseType: "COMMERCIAL_CREDIT",
      title: `Phase 3 evidence case ${suffix}`,
      priority: "NORMAL",
      externalReference: `EVIDENCE-${suffix}`,
    },
  })
).body;

const cleanV1 = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n",
);
const cleanHashV1 = createHash("sha256").update(cleanV1).digest("hex");
const created = (
  await request(`/api/v1/cases/${decisionCase.id}/evidence`, {
    method: "POST",
    expected: [202],
    token,
    headers: { "idempotency-key": `phase3-clean-v1-${suffix}` },
    body: uploadForm({
      bytes: cleanV1,
      filename: "statement-v1.pdf",
      title: "Validated account statement",
    }),
  })
).body;
assert.equal(created.status, "PROCESSING");

const sameRequest = (
  await request(`/api/v1/cases/${decisionCase.id}/evidence`, {
    method: "POST",
    expected: [202],
    token,
    headers: { "idempotency-key": `phase3-clean-v1-${suffix}` },
    body: uploadForm({
      bytes: cleanV1,
      filename: "statement-v1.pdf",
      title: "Validated account statement",
    }),
  })
).body;
assert.equal(sameRequest.id, created.id, "Idempotent upload changed asset ID.");

await request(`/api/v1/cases/${decisionCase.id}/evidence`, {
  method: "POST",
  expected: [409],
  token,
  headers: { "idempotency-key": `phase3-clean-v1-${suffix}` },
  body: uploadForm({
    bytes: cleanV1,
    filename: "statement-v1.pdf",
    title: "Different title",
  }),
});

const availableV1 = await waitFor(
  "clean evidence availability",
  async () =>
    (
      await request(`/api/v1/evidence/${created.id}`, {
        token,
      })
    ).body,
  (asset) =>
    asset.status === "ACTIVE" &&
    asset.currentVersion?.processingStatus === "AVAILABLE",
);
assert.equal(availableV1.currentVersion.sha256, cleanHashV1);
assert.equal(availableV1.currentVersion.versionNumber, 1);

await request(
  `/api/v1/evidence/${created.id}/versions/${availableV1.currentVersion.id}/download-grant`,
  { method: "POST", expected: [401] },
);
const grantV1 = (
  await request(
    `/api/v1/evidence/${created.id}/versions/${availableV1.currentVersion.id}/download-grant`,
    { method: "POST", token },
  )
).body;
const downloadedV1 = (await request(grantV1.url, { token, expected: [200] }))
  .body;
assert.deepEqual(Buffer.from(downloadedV1), cleanV1);

const integrity = (
  await request(
    `/api/v1/evidence/${created.id}/versions/${availableV1.currentVersion.id}/integrity-checks`,
    { method: "POST", expected: [202], token },
  )
).body;
await waitFor(
  "integrity verification",
  async () =>
    (
      await request(`/api/v1/evidence/${created.id}/integrity-checks`, {
        token,
      })
    ).body,
  (checks) =>
    checks.some(
      (check) => check.id === integrity.id && check.status === "MATCH",
    ),
);

const cleanV2 = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Version /1.7 >>\nendobj\ntrailer\n<<>>\n%%EOF\n",
);
const replacement = (
  await request(`/api/v1/evidence/${created.id}/versions`, {
    method: "POST",
    expected: [202],
    token,
    headers: { "idempotency-key": `phase3-clean-v2-${suffix}` },
    body: uploadForm({
      bytes: cleanV2,
      filename: "statement-v2.pdf",
      title: "Validated account statement",
      reason: "REPLACEMENT",
    }),
  })
).body;
assert.equal(replacement.latestVersionNumber, 2);
const availableV2 = await waitFor(
  "replacement availability",
  async () =>
    (
      await request(`/api/v1/evidence/${created.id}`, {
        token,
      })
    ).body,
  (asset) => asset.currentVersion?.versionNumber === 2,
);
const versions = (
  await request(`/api/v1/evidence/${created.id}/versions`, { token })
).body;
assert.equal(versions.length, 2);
const v1After = versions.find((version) => version.versionNumber === 1);
assert.equal(v1After.sha256, cleanHashV1, "Version 1 hash was mutated.");
assert.equal(availableV2.currentVersion.previousVersionId, v1After.id);
assert.equal(availableV2.currentVersion.previousSha256, cleanHashV1);

const staleVersion = availableV2.rowVersion;
const updated = (
  await request(`/api/v1/evidence/${created.id}`, {
    method: "PATCH",
    token,
    json: {
      rowVersion: staleVersion,
      description: "Metadata concurrency validated.",
    },
  })
).body;
assert(updated.rowVersion > staleVersion);
await request(`/api/v1/evidence/${created.id}`, {
  method: "PATCH",
  expected: [409],
  token,
  json: { rowVersion: staleVersion, title: "Stale write" },
});

const eicarText = [
  "X5O!P%@AP",
  "[4\\PZX54(P^)7CC)7}$",
  "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
].join("");
const infectedBytes = Buffer.from(eicarText);
const infectedForm = new FormData();
infectedForm.append("classificationCode", "OTHER");
infectedForm.append("title", "Harmless antivirus validation fixture");
infectedForm.append("declaredSizeBytes", String(infectedBytes.length));
infectedForm.append("reason", "INITIAL");
infectedForm.append(
  "file",
  new Blob([infectedBytes], { type: "text/plain" }),
  "scan-test.txt",
);
const infected = (
  await request(`/api/v1/cases/${decisionCase.id}/evidence`, {
    method: "POST",
    expected: [202],
    token,
    headers: { "idempotency-key": `phase3-infected-${suffix}` },
    body: infectedForm,
  })
).body;
const rejected = await waitFor(
  "malware rejection",
  async () =>
    (
      await request(`/api/v1/evidence/${infected.id}`, {
        token,
      })
    ).body,
  (asset) => asset.status === "REJECTED",
);
const rejectedVersions = (
  await request(`/api/v1/evidence/${infected.id}/versions`, { token })
).body;
assert.equal(rejectedVersions[0].processingStatus, "REJECTED");
await request(
  `/api/v1/evidence/${infected.id}/versions/${rejectedVersions[0].id}/download-grant`,
  { method: "POST", expected: [409], token },
);

const source = (
  await request("/api/v1/integration/sources", {
    method: "POST",
    expected: [201],
    token,
    json: { code: `EV${suffix}`, name: "Evidence reference source" },
  })
).body;
await request(`/api/v1/integration/sources/${source.id}/activate`, {
  method: "POST",
  expected: [201],
  token,
  json: {},
});
const connector = (
  await request(`/api/v1/integration/sources/${source.id}/connectors`, {
    method: "POST",
    expected: [201],
    token,
    json: {
      name: "Evidence reference trigger",
      type: "WEBHOOK",
      triggerType: "evidence.reference.received",
      configuration: { rateLimitPerMinute: 100 },
    },
  })
).body;
const webhookKey = `phase3-evidence-key-${suffix}`;
await request(`/api/v1/integration/connectors/${connector.id}/credentials`, {
  method: "PUT",
  token,
  json: { value: webhookKey },
});
await request(
  `/api/v1/integration/connectors/${connector.id}/extraction-rules`,
  {
    method: "PUT",
    token,
    json: {
      rules: [
        {
          targetField: "businessReference",
          sourcePath: "$.caseReference",
          required: true,
          transform: "TRIM",
        },
        {
          targetField: "classificationCode",
          sourcePath: "$.evidence.classificationCode",
          required: true,
          transform: "UPPERCASE",
        },
        {
          targetField: "title",
          sourcePath: "$.evidence.title",
          required: true,
          transform: "TRIM",
        },
        {
          targetField: "externalReference",
          sourcePath: "$.evidence.externalReference",
          required: true,
          transform: "TRIM",
        },
      ],
    },
  },
);
await request(
  `/api/v1/integration/connectors/${connector.id}/correlation-rules`,
  {
    method: "PUT",
    token,
    json: {
      name: "Evidence case reference",
      ruleType: "BUSINESS_REFERENCE_EQUALS",
    },
  },
);
await request(`/api/v1/integration/connectors/${connector.id}/activate`, {
  method: "POST",
  expected: [201],
  token,
  json: {},
});
const hookPath = `/api/v1/integration/hooks/${connector.connectorKey}`;
const sourceEventId = `evidence-reference-${suffix}`;
const triggerBody = {
  caseReference: decisionCase.externalReference,
  evidence: {
    classificationCode: "IDENTITY",
    title: "Identity document requested by source",
    externalReference: `SOURCE-DOC-${suffix}`,
  },
};
await request(hookPath, {
  method: "POST",
  expected: [202],
  headers: {
    "x-cdep-webhook-key": webhookKey,
    "x-source-event-id": sourceEventId,
  },
  json: triggerBody,
});
await request(hookPath, {
  method: "POST",
  expected: [202],
  headers: {
    "x-cdep-webhook-key": webhookKey,
    "x-source-event-id": sourceEventId,
  },
  json: triggerBody,
});
const evidenceList = await waitFor(
  "source evidence reference",
  async () =>
    (
      await request(
        `/api/v1/cases/${decisionCase.id}/evidence?source=SOURCE_TRIGGER_REFERENCE&pageSize=100`,
        { token },
      )
    ).body,
  (list) =>
    list.items.some(
      (item) =>
        item.externalReference === `SOURCE-DOC-${suffix}` &&
        item.status === "AWAITING_CONTENT",
    ),
);
assert.equal(
  evidenceList.items.filter(
    (item) => item.externalReference === `SOURCE-DOC-${suffix}`,
  ).length,
  1,
  "Duplicate trigger created duplicate evidence assets.",
);
const caseProjection = await waitFor(
  "Case evidence projection",
  async () =>
    (
      await request(`/api/v1/cases/${decisionCase.id}/evidence-references`, {
        token,
      })
    ).body,
  (projection) =>
    projection.items.some((item) => item.evidenceAssetId === created.id),
);
assert.equal(
  new Set(caseProjection.timeline.map((entry) => entry.eventId)).size,
  caseProjection.timeline.length,
  "Case evidence timeline contains duplicate event projections.",
);

process.stdout.write(
  `${JSON.stringify({
    phase: "3",
    result: "PASS",
    caseId: decisionCase.id,
    evidenceAssetId: created.id,
    currentVersionId: availableV2.currentVersion.id,
    infectedEvidenceAssetId: infected.id,
    sourceReferenceCount: evidenceList.items.length,
  })}\n`,
);

if (process.env.CDEP_RUN_PHASE2B_REGRESSION === "true") {
  await import("./validate-phase2b.mjs");
}
