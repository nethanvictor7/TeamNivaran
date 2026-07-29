import assert from "node:assert/strict";

const base = process.env.CDEP_BASE_URL ?? "http://api-gateway:3000";
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@cdep.local";
const reviewerEmail =
  process.env.BOOTSTRAP_REVIEWER_EMAIL ?? "reviewer@cdep.local";
const approverEmail =
  process.env.BOOTSTRAP_APPROVER_EMAIL ?? "approver@cdep.local";
const outsiderEmail =
  process.env.BOOTSTRAP_OUTSIDER_EMAIL ?? "outsider@cdep.local";
assert(password, "Phase 6 validator requires BOOTSTRAP_ADMIN_PASSWORD.");

let assertions = 0;
function check(condition, message) {
  assert(condition, message);
  assertions += 1;
}

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
  const result = contentType.includes("json")
    ? await response.json()
    : await response.text();
  assert(
    expected.includes(response.status),
    `${init.method ?? "GET"} ${path}: expected ${expected.join("/")} but got ${response.status}: ${JSON.stringify(result)}`,
  );
  return result;
}

async function login(email) {
  const result = await request("/api/v1/auth/login", {
    method: "POST",
    json: { email, password },
  });
  check(Boolean(result.accessToken), `Login failed for ${email}.`);
  return result.accessToken;
}

async function waitFor(description, operation, predicate, timeout = 180_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`${description} timed out: ${JSON.stringify(last)}`);
}

function evidenceForm(suffix) {
  const bytes = Buffer.from(
    `CDEP Phase 6 controlled evidence ${suffix}\nNo personal data.\n`,
  );
  const form = new FormData();
  form.append("classificationCode", "APPLICATION_FORM");
  form.append("title", "Phase 6 controlled proof fixture");
  form.append("description", "Deterministic Fabric end-to-end validation");
  form.append("declaredSizeBytes", String(bytes.length));
  form.append("reason", "INITIAL");
  form.append(
    "file",
    new Blob([bytes], { type: "text/plain" }),
    "phase6-proof.txt",
  );
  return form;
}

async function currentWorkflow(caseId, token) {
  const response = await request(`/api/v1/cases/${caseId}/workflow`, {
    token,
  });
  check(response.items.length > 0, "Workflow cycle is missing.");
  return response.items[0];
}

const suffix = String(Date.now());
const [admin, reviewer, approver, outsider] = await Promise.all([
  login(adminEmail),
  login(reviewerEmail),
  login(approverEmail),
  login(outsiderEmail),
]);

const readiness = await request("/health/ready");
check(readiness.status === "ok", "Gateway readiness failed.");
check(
  readiness.dependencies.ledgerService === "up",
  "Ledger service is absent from gateway readiness.",
);
await request("/api/v1/ledger/network/status", { expected: [401] });
assertions += 1;
const network = await request("/api/v1/ledger/network/status", {
  token: admin,
});
check(network.providerType === "FABRIC", "FABRIC is not the active provider.");
check(network.state === "AVAILABLE", "Fabric provider is not available.");
check(
  !("channelName" in network) &&
    !("chaincodeName" in network) &&
    !("mspId" in network) &&
    !("peer" in network),
  "Network status leaked a Fabric-specific public field.",
);

const created = await request("/api/v1/cases", {
  method: "POST",
  expected: [201],
  token: admin,
  headers: { "idempotency-key": `phase6-case-${suffix}` },
  json: {
    caseType: "COMMERCIAL_CREDIT",
    title: `Phase 6 Fabric proof case ${suffix}`,
    priority: "NORMAL",
    requestedAmountMinor: 4500000,
    currency: "GBP",
    externalReference: `P6-${suffix}`,
  },
});
const opened = await request(`/api/v1/cases/${created.id}`, {
  method: "PATCH",
  token: admin,
  json: { version: created.version, status: "OPEN" },
});
check(opened.status === "OPEN", "Case was not opened.");
const uploaded = await request(`/api/v1/cases/${created.id}/evidence`, {
  method: "POST",
  expected: [202],
  token: admin,
  headers: { "idempotency-key": `phase6-evidence-${suffix}` },
  body: evidenceForm(suffix),
});
const evidence = await waitFor(
  "Evidence availability",
  () => request(`/api/v1/evidence/${uploaded.id}`, { token: admin }),
  (item) =>
    item.status === "ACTIVE" &&
    item.currentVersion?.processingStatus === "AVAILABLE",
);
check(
  /^[a-f0-9]{64}$/.test(evidence.currentVersion.sha256),
  "Available Evidence has no SHA-256.",
);

const evidenceProofPath =
  `/api/v1/evidence/${evidence.id}/versions/` +
  `${evidence.currentVersion.id}/proofs`;
const proofKey = `phase6-proof-${suffix}`;
const queuedEvidenceProof = await request(evidenceProofPath, {
  method: "POST",
  expected: [202],
  token: admin,
  headers: { "idempotency-key": proofKey },
  json: {},
});
check(
  queuedEvidenceProof.status === "PENDING",
  "Evidence proof did not return a durable PENDING request.",
);
check(
  queuedEvidenceProof.providerType === "FABRIC",
  "Evidence proof is not bound to FABRIC.",
);
const duplicateEvidenceProof = await request(evidenceProofPath, {
  method: "POST",
  expected: [202],
  token: admin,
  headers: { "idempotency-key": proofKey },
  json: {},
});
check(
  duplicateEvidenceProof.id === queuedEvidenceProof.id &&
    duplicateEvidenceProof.proofId === queuedEvidenceProof.proofId,
  "Evidence proof initiation is not idempotent.",
);
const confirmedEvidenceProof = await waitFor(
  "Fabric evidence proof confirmation",
  () => request(evidenceProofPath, { token: admin }),
  (items) =>
    items.some(
      (item) =>
        item.id === queuedEvidenceProof.id &&
        item.state === "CONFIRMED" &&
        item.binding?.providerTransactionId,
    ),
);
const evidenceProof = confirmedEvidenceProof.find(
  (item) => item.id === queuedEvidenceProof.id,
);
check(evidenceProof.providerType === "FABRIC", "Provider binding changed.");
check(
  Boolean(evidenceProof.binding.providerProofReference),
  "Opaque provider proof reference is missing.",
);
check(
  evidenceProof.binding.providerMetadataSchemaVersion === "1.0",
  "Provider metadata schema version is missing.",
);
for (const forbidden of [
  "channelName",
  "chaincodeName",
  "mspId",
  "certificate",
  "privateKey",
  "peer",
  "blockNumber",
]) {
  check(
    !Object.hasOwn(evidenceProof.binding, forbidden),
    `Evidence proof leaked Fabric field ${forbidden}.`,
  );
}
const evidenceVerification = await request(`${evidenceProofPath}/verify`, {
  method: "POST",
  token: admin,
  json: {},
});
check(
  evidenceVerification.offLedgerStatus === "OFF_LEDGER_HASH_MATCH",
  "Off-ledger Evidence hash did not match.",
);
check(
  evidenceVerification.ledgerProofStatus === "LEDGER_PROOF_CONFIRMED",
  "Fabric Evidence proof was not confirmed.",
);
check(
  evidenceVerification.ledgerHashStatus === "LEDGER_HASH_MATCH",
  "Fabric Evidence hash did not match.",
);
const transaction = await request(
  `/api/v1/ledger/transactions/${encodeURIComponent(
    evidenceProof.binding.providerTransactionId,
  )}`,
  { token: admin },
);
check(
  transaction.state === "FINALIZED",
  "Fabric transaction is not finalized.",
);
check(
  transaction.providerType === "FABRIC",
  "Transaction provider binding changed.",
);
await request(evidenceProofPath, { token: outsider, expected: [403] });
assertions += 1;
await request(`/api/v1/ledger/proofs/${queuedEvidenceProof.id}/retry`, {
  method: "POST",
  token: admin,
  expected: [409],
  json: {},
});
assertions += 1;

const started = await request(`/api/v1/cases/${created.id}/workflow/start`, {
  method: "POST",
  expected: [201],
  token: admin,
  headers: { "idempotency-key": `phase6-workflow-${suffix}` },
  json: {},
});
const validated = await request(
  `/api/v1/cases/${created.id}/workflow/validate`,
  {
    method: "POST",
    token: admin,
    json: { expectedVersion: started.rowVersion },
  },
);
check(validated.validationRun.status === "PASS", "Workflow validation failed.");
await request(`/api/v1/workflow/tasks/${validated.task.id}/claim`, {
  method: "POST",
  token: reviewer,
  json: { taskVersion: validated.task.rowVersion },
});
let workflow = await currentWorkflow(created.id, reviewer);
const evidenceVersionIds = workflow.validations[0].evidenceSnapshot.map(
  (item) => item.evidenceVersionId,
);
const review = await request(
  `/api/v1/workflow/tasks/${validated.task.id}/submit-review`,
  {
    method: "POST",
    token: reviewer,
    json: {
      workflowVersion: workflow.rowVersion,
      taskVersion: validated.task.rowVersion + 1,
      outcome: "READY_FOR_RECOMMENDATION",
      reasonCodes: ["STANDARD_REVIEW"],
      rationale: "Independent human review completed for Phase 6.",
      evidenceVersionIds,
    },
  },
);
check(
  review.workflow.state === "READY_FOR_RECOMMENDATION",
  "Review did not complete.",
);
workflow = await currentWorkflow(created.id, admin);
const recommendation = await request(
  `/api/v1/cases/${created.id}/recommendations`,
  {
    method: "POST",
    token: admin,
    json: {
      workflowVersion: workflow.rowVersion,
      outcome: "RECOMMEND_APPROVAL",
      reasonCodes: ["STANDARD_REVIEW"],
      rationale: "Human recommendation for the Fabric proof validator.",
      conditions: [],
      supportingAssessmentIds: [],
    },
  },
);
check(
  recommendation.workflow.state === "DECISION_PENDING",
  "Recommendation did not enter decision pending.",
);
workflow = await currentWorkflow(created.id, approver);
const approvalTask = workflow.tasks.find(
  (task) =>
    task.taskType === "APPROVE_DECISION" &&
    ["PENDING", "CLAIMED"].includes(task.status),
);
check(Boolean(approvalTask), "Approval task is missing.");
const finalDecision = await request(
  `/api/v1/cases/${created.id}/decision/approve`,
  {
    method: "POST",
    expected: [201],
    token: approver,
    headers: { "idempotency-key": `phase6-decision-${suffix}` },
    json: {
      workflowVersion: workflow.rowVersion,
      taskVersion: approvalTask.rowVersion,
      reasonCodes: ["STANDARD_REVIEW"],
      rationale: "Independent terminal human decision for Phase 6.",
    },
  },
);
check(
  finalDecision.workflow.state === "APPROVED" &&
    finalDecision.decision.outcome === "APPROVED",
  "Terminal human decision was not persisted.",
);

const decisionProofPath = `/api/v1/cases/${created.id}/decision-proof`;
const queuedDecisionProof = await request(decisionProofPath, {
  method: "POST",
  expected: [202],
  token: approver,
  headers: { "idempotency-key": `phase6-decision-proof-${suffix}` },
  json: {},
});
check(
  queuedDecisionProof.status === "PENDING",
  "Decision proof did not return a durable PENDING request.",
);
const confirmedDecisionProof = await waitFor(
  "Fabric decision proof confirmation",
  () => request(decisionProofPath, { token: approver }),
  (item) =>
    item.id === queuedDecisionProof.id &&
    item.state === "CONFIRMED" &&
    item.binding?.providerTransactionId,
);
check(
  confirmedDecisionProof.decisionRecord.decisionId ===
    finalDecision.decision.id,
  "Decision proof is not bound to the terminal decision.",
);
const decisionVerification = await request(`${decisionProofPath}/verify`, {
  method: "POST",
  token: approver,
  json: {},
});
check(
  decisionVerification.offLedgerStatus === "OFF_LEDGER_HASH_MATCH" &&
    decisionVerification.ledgerProofStatus === "LEDGER_PROOF_CONFIRMED" &&
    decisionVerification.ledgerHashStatus === "LEDGER_HASH_MATCH",
  "Decision package did not pass local and Fabric verification.",
);
const reconciliation = await request("/api/v1/ledger/reconciliation/run", {
  method: "POST",
  expected: [201],
  token: admin,
  json: {},
});
check(
  reconciliation.status === "COMPLETED",
  "Ledger reconciliation did not complete.",
);

console.log(
  JSON.stringify({
    result: "PASS Phase 6 Fabric Docker end-to-end validation",
    assertions,
    caseId: created.id,
    evidenceId: evidence.id,
    evidenceVersionId: evidence.currentVersion.id,
    evidenceProofId: queuedEvidenceProof.proofId,
    evidenceTransactionId: evidenceProof.binding.providerTransactionId,
    decisionProofId: queuedDecisionProof.proofId,
    decisionTransactionId: confirmedDecisionProof.binding.providerTransactionId,
  }),
);
