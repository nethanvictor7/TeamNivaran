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
assert(password, "Phase 4 validator requires BOOTSTRAP_ADMIN_PASSWORD.");

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
    : await response.text();
  assert(
    expected.includes(response.status),
    `${init.method ?? "GET"} ${path}: expected ${expected.join("/")} but received ${response.status}: ${JSON.stringify(responseBody)}`,
  );
  return responseBody;
}

async function login(email) {
  const result = await request("/api/v1/auth/login", {
    method: "POST",
    json: { email, password },
  });
  assert(result.accessToken, `Login failed for ${email}.`);
  return result.accessToken;
}

async function waitFor(description, operation, predicate, timeout = 180_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`${description} timed out: ${JSON.stringify(last)}`);
}

function evidenceForm(suffix) {
  const bytes = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Phase4 (${suffix}) >>\nendobj\ntrailer\n<<>>\n%%EOF\n`,
  );
  const form = new FormData();
  form.append("classificationCode", "APPLICATION_FORM");
  form.append("title", "Governed application form");
  form.append("description", "Phase 4 deterministic validation fixture");
  form.append("declaredSizeBytes", String(bytes.length));
  form.append("reason", "INITIAL");
  form.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    "application-form.pdf",
  );
  return form;
}

async function createReadyCase(token, suffix) {
  const created = await request("/api/v1/cases", {
    method: "POST",
    expected: [201],
    token,
    headers: { "idempotency-key": `phase4-case-${suffix}` },
    json: {
      caseType: "COMMERCIAL_CREDIT",
      title: `Phase 4 governed case ${suffix}`,
      priority: "NORMAL",
      requestedAmountMinor: 2500000,
      currency: "GBP",
      externalReference: `WF-${suffix}`,
    },
  });
  const opened = await request(`/api/v1/cases/${created.id}`, {
    method: "PATCH",
    token,
    json: { version: created.version, status: "OPEN" },
  });
  const evidence = await request(`/api/v1/cases/${created.id}/evidence`, {
    method: "POST",
    expected: [202],
    token,
    headers: { "idempotency-key": `phase4-evidence-${suffix}` },
    body: evidenceForm(suffix),
  });
  const available = await waitFor(
    "Evidence availability",
    () => request(`/api/v1/evidence/${evidence.id}`, { token }),
    (asset) =>
      asset.status === "ACTIVE" &&
      asset.currentVersion?.processingStatus === "AVAILABLE",
  );
  assert.match(available.currentVersion.sha256, /^[a-f0-9]{64}$/);
  return { case: opened, evidence: available };
}

async function createOpenCase(token, suffix) {
  const created = await request("/api/v1/cases", {
    method: "POST",
    expected: [201],
    token,
    headers: { "idempotency-key": `phase4-open-case-${suffix}` },
    json: {
      caseType: "COMMERCIAL_CREDIT",
      title: `Phase 4 open case ${suffix}`,
      priority: "NORMAL",
      requestedAmountMinor: 1000000,
      currency: "GBP",
      externalReference: `WF-OPEN-${suffix}`,
    },
  });
  return request(`/api/v1/cases/${created.id}`, {
    method: "PATCH",
    token,
    json: { version: created.version, status: "OPEN" },
  });
}

async function currentWorkflow(caseId, token) {
  const response = await request(`/api/v1/cases/${caseId}/workflow`, {
    token,
  });
  assert(response.items.length > 0, "Workflow cycle is missing.");
  return (
    response.items.find(
      (item) =>
        !["APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED"].includes(
          item.state,
        ),
    ) ?? response.items[0]
  );
}

const suffix = String(Date.now());
const [admin, reviewer, approver, outsider] = await Promise.all([
  login(adminEmail),
  login(reviewerEmail),
  login(approverEmail),
  login(outsiderEmail),
]);

await request("/api/v1/workflow/tasks", { expected: [401] });
<<<<<<< HEAD
const manualDefinition = await request("/api/v1/workflow-definitions", {
  method: "POST",
  expected: [201],
  token: admin,
  json: {
    code: `VALIDATOR-MANUAL-${suffix}`,
    name: `Validator manual definition ${suffix}`,
    description: "Repeatable manual workflow regression definition.",
    isDefault: true,
  },
});
const manualDefinitionVersion = await request(
  `/api/v1/workflow-definitions/${manualDefinition.id}/versions`,
  {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      startMode: "MANUAL",
      warningPolicy: "NON_BLOCKING",
      fourEyesEnabled: true,
      prohibitEvidenceSubmitterApproval: false,
      prohibitReviewerApproval: false,
      defaultReviewDueHours: 24,
      defaultDecisionDueHours: 24,
      configuration: {
        caseTypes: ["COMMERCIAL_CREDIT"],
        requiredEvidence: [
          {
            classificationCode: "APPLICATION_FORM",
            minimumCount: 1,
            currentOnly: true,
          },
        ],
        rules: [
          {
            id: "application-form-present",
            type: "REQUIRED_EVIDENCE_PRESENT",
            classificationCode: "APPLICATION_FORM",
          },
          {
            id: "case-title-present",
            type: "CASE_FIELD_PRESENT",
            field: "title",
          },
        ],
        reasonCodes: [
          "STANDARD_REVIEW",
          "INFORMATION_REQUIRED",
          "POLICY_REQUIREMENT",
        ],
        reviewOutcomes: ["READY_FOR_RECOMMENDATION", "CORRECTION_REQUIRED"],
      },
    },
  },
);
await request(
  `/api/v1/workflow-definitions/${manualDefinition.id}/versions/${manualDefinitionVersion.id}/publish`,
  { method: "POST", expected: [201], token: admin, json: {} },
);
=======
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
const primary = await createReadyCase(admin, `${suffix}-primary`);
const startKey = `phase4-start-${suffix}`;
const started = await request(
  `/api/v1/cases/${primary.case.id}/workflow/start`,
  {
    method: "POST",
    expected: [201],
    token: admin,
    headers: { "idempotency-key": startKey },
<<<<<<< HEAD
    json: { definitionVersionId: manualDefinitionVersion.id },
=======
    json: {},
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
  },
);
const duplicateStart = await request(
  `/api/v1/cases/${primary.case.id}/workflow/start`,
  {
    method: "POST",
    expected: [201],
    token: admin,
    headers: { "idempotency-key": startKey },
<<<<<<< HEAD
    json: { definitionVersionId: manualDefinitionVersion.id },
=======
    json: {},
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
  },
);
assert.equal(
  duplicateStart.id,
  started.id,
  "Workflow start was not idempotent.",
);
await request(`/api/v1/cases/${primary.case.id}/workflow/start`, {
  method: "POST",
  expected: [409],
  token: admin,
  headers: { "idempotency-key": startKey },
  json: {
    definitionVersionId: "00000000-0000-4000-8000-000000000402",
  },
});

const validation = await request(
  `/api/v1/cases/${primary.case.id}/workflow/validate`,
  {
    method: "POST",
    token: admin,
    json: { expectedVersion: started.rowVersion },
  },
);
assert.equal(validation.validationRun.status, "PASS");
assert(
  validation.validationRun.results.every((result) => result.status === "PASS"),
);
assert.equal(validation.workflow.state, "READY_FOR_REVIEW");
await request(`/api/v1/cases/${primary.case.id}/workflow/validate`, {
  method: "POST",
  expected: [409],
  token: admin,
  json: { expectedVersion: started.rowVersion },
});

const reviewTask = validation.task;
await request(`/api/v1/workflow/tasks/${reviewTask.id}/claim`, {
  method: "POST",
  token: reviewer,
  json: { taskVersion: reviewTask.rowVersion },
});
await request(`/api/v1/workflow/tasks/${reviewTask.id}/claim`, {
  method: "POST",
  expected: [409],
  token: admin,
  json: { taskVersion: reviewTask.rowVersion },
});
let workflow = await currentWorkflow(primary.case.id, reviewer);
const pinnedVersions = workflow.validations[0].evidenceSnapshot.map(
  (item) => item.evidenceVersionId,
);
const review = await request(
  `/api/v1/workflow/tasks/${reviewTask.id}/submit-review`,
  {
    method: "POST",
    token: reviewer,
    json: {
      workflowVersion: workflow.rowVersion,
      taskVersion: reviewTask.rowVersion + 1,
      outcome: "READY_FOR_RECOMMENDATION",
      reasonCodes: ["STANDARD_REVIEW"],
      rationale: "Independent review completed against the pinned Evidence.",
      evidenceVersionIds: pinnedVersions,
    },
  },
);
assert.equal(review.workflow.state, "READY_FOR_RECOMMENDATION");

workflow = await currentWorkflow(primary.case.id, admin);
const recommendation = await request(
  `/api/v1/cases/${primary.case.id}/recommendations`,
  {
    method: "POST",
    token: admin,
    json: {
      workflowVersion: workflow.rowVersion,
      outcome: "RECOMMEND_APPROVAL",
      reasonCodes: ["STANDARD_REVIEW"],
      rationale: "Human recommendation after deterministic validation.",
      conditions: [],
      supportingAssessmentIds: [],
    },
  },
);
assert.equal(recommendation.workflow.state, "DECISION_PENDING");
assert.equal(recommendation.recommendation.outcome, "RECOMMEND_APPROVAL");

workflow = await currentWorkflow(primary.case.id, admin);
const approvalTask = workflow.tasks.find(
  (task) =>
    task.taskType === "APPROVE_DECISION" &&
    ["PENDING", "CLAIMED"].includes(task.status),
);
assert(approvalTask, "Approval task was not created.");
const decisionBody = {
  workflowVersion: workflow.rowVersion,
  taskVersion: approvalTask.rowVersion,
  reasonCodes: ["STANDARD_REVIEW"],
  rationale: "Final human decision after independent recommendation.",
};
await request(`/api/v1/cases/${primary.case.id}/decision/approve`, {
  method: "POST",
  expected: [409],
  token: admin,
  headers: { "idempotency-key": `phase4-self-approve-${suffix}` },
  json: decisionBody,
});
const final = await request(
  `/api/v1/cases/${primary.case.id}/decision/approve`,
  {
    method: "POST",
    expected: [201],
    token: approver,
    headers: { "idempotency-key": `phase4-approve-${suffix}` },
    json: decisionBody,
  },
);
assert.equal(final.decision.outcome, "APPROVED");
assert.equal(final.workflow.state, "APPROVED");
const duplicateDecision = await request(
  `/api/v1/cases/${primary.case.id}/decision/approve`,
  {
    method: "POST",
    expected: [201],
    token: approver,
    headers: { "idempotency-key": `phase4-approve-${suffix}` },
    json: decisionBody,
  },
);
assert.equal(duplicateDecision.decision.id, final.decision.id);
const decisionHistory = await request(
  `/api/v1/cases/${primary.case.id}/decisions`,
  { token: approver },
);
assert.equal(decisionHistory[0].id, final.decision.id);
assert.equal(
  decisionHistory[0].evidence[0].evidenceVersionId,
  pinnedVersions[0],
);
const decisionDetail = await request(`/api/v1/decisions/${final.decision.id}`, {
  token: approver,
});
assert.equal(decisionDetail.id, final.decision.id);
await request(`/api/v1/decisions/${final.decision.id}`, {
  token: outsider,
  expected: [404],
});

const caseAfter = await waitFor(
  "Case decision synchronization",
  () => request(`/api/v1/cases/${primary.case.id}`, { token: admin }),
  (item) => item.status === "DECIDED",
);
assert.equal(caseAfter.status, "DECIDED");
const timeline = await request(`/api/v1/cases/${primary.case.id}/timeline`, {
  token: admin,
});
assert(timeline.some((entry) => entry.toStatus === "DECIDED"));
await request(`/api/v1/cases/${primary.case.id}/workflow`, {
  token: outsider,
  expected: [404],
});
const reopenKey = `phase4-reopen-${suffix}`;
const reopened = await request(
  `/api/v1/cases/${primary.case.id}/workflow/reopen`,
  {
    method: "POST",
    token: admin,
    headers: { "idempotency-key": reopenKey },
    json: { reason: "Authorized post-decision reconsideration." },
  },
);
assert.equal(reopened.cycleNumber, 2);
assert.equal(reopened.state, "NOT_STARTED");
const duplicateReopen = await request(
  `/api/v1/cases/${primary.case.id}/workflow/reopen`,
  {
    method: "POST",
    token: admin,
    headers: { "idempotency-key": reopenKey },
    json: { reason: "Authorized post-decision reconsideration." },
  },
);
assert.equal(duplicateReopen.id, reopened.id);
const reopenedCycles = await request(
  `/api/v1/cases/${primary.case.id}/workflow`,
  { token: admin },
);
assert.equal(reopenedCycles.items.length, 2);
assert(
  reopenedCycles.items.some(
    (item) =>
      item.cycleNumber === 1 &&
      item.state === "APPROVED" &&
      item.decisions[0]?.id === final.decision.id,
  ),
  "Reopen mutated the prior terminal workflow or decision.",
);

const definition = await request("/api/v1/workflow-definitions", {
  method: "POST",
  expected: [201],
  token: admin,
  json: {
    code: `VALIDATOR-${suffix}`,
    name: `Validator definition ${suffix}`,
    description: "Immutable publication lifecycle validator.",
    isDefault: true,
  },
});
const definitionVersion = await request(
  `/api/v1/workflow-definitions/${definition.id}/versions`,
  {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      startMode: "AUTO_ON_CASE_OPENED",
      warningPolicy: "NON_BLOCKING",
      fourEyesEnabled: true,
      prohibitEvidenceSubmitterApproval: false,
      prohibitReviewerApproval: false,
      defaultReviewDueHours: 24,
      defaultDecisionDueHours: 24,
      configuration: {
        caseTypes: ["COMMERCIAL_CREDIT"],
        requiredEvidence: [],
        rules: [
          {
            id: "case-title-present",
            type: "CASE_FIELD_PRESENT",
            field: "title",
          },
        ],
        reasonCodes: ["STANDARD_REVIEW"],
        reviewOutcomes: ["READY_FOR_RECOMMENDATION"],
      },
    },
  },
);
await request(
  `/api/v1/workflow-definitions/${definition.id}/versions/${definitionVersion.id}/publish`,
  { method: "POST", expected: [201], token: admin, json: {} },
);
const autoCase = await createOpenCase(admin, `${suffix}-auto`);
const autoWorkflow = await waitFor(
  "Automatic Workflow start",
  () =>
    request(`/api/v1/cases/${autoCase.id}/workflow`, {
      token: admin,
    }),
  (result) => result.items.length === 1,
);
assert.equal(
  autoWorkflow.items[0].workflowDefinitionVersionId,
  definitionVersion.id,
);
await request(
  `/api/v1/workflow-definitions/${definition.id}/versions/${definitionVersion.id}`,
  {
    method: "PATCH",
    expected: [409],
    token: admin,
    json: {
      startMode: "AUTO_ON_CASE_OPENED",
      warningPolicy: "NON_BLOCKING",
      fourEyesEnabled: true,
      prohibitEvidenceSubmitterApproval: false,
      prohibitReviewerApproval: false,
      defaultReviewDueHours: 24,
      defaultDecisionDueHours: 24,
      configuration: {
        caseTypes: ["COMMERCIAL_CREDIT"],
        requiredEvidence: [],
        rules: [
          {
            id: "case-title-present",
            type: "CASE_FIELD_PRESENT",
            field: "title",
          },
        ],
        reasonCodes: ["STANDARD_REVIEW"],
        reviewOutcomes: ["READY_FOR_RECOMMENDATION"],
      },
    },
  },
);
await request(`/api/v1/workflow-definitions/${definition.id}`, {
  token: outsider,
  expected: [404],
});
await request(
  `/api/v1/workflow-definitions/${definition.id}/versions/${definitionVersion.id}/retire`,
  { method: "POST", expected: [201], token: admin, json: {} },
);
const retiredCase = await createOpenCase(admin, `${suffix}-retired`);
await request(`/api/v1/cases/${retiredCase.id}/workflow/start`, {
  method: "POST",
  expected: [422],
  token: admin,
  headers: { "idempotency-key": `phase4-retired-start-${suffix}` },
  json: { definitionVersionId: definitionVersion.id },
});
const pinnedAfterRetire = await request(
  `/api/v1/cases/${autoCase.id}/workflow`,
  { token: admin },
);
assert.equal(
  pinnedAfterRetire.items[0].workflowDefinitionVersionId,
  definitionVersion.id,
  "Retirement changed an active instance's pinned definition.",
);

const correctionCase = await createReadyCase(admin, `${suffix}-correction`);
const correctionStart = await request(
  `/api/v1/cases/${correctionCase.case.id}/workflow/start`,
  {
    method: "POST",
    expected: [201],
    token: admin,
    headers: { "idempotency-key": `phase4-correction-start-${suffix}` },
    json: {},
  },
);
const correctionValidation = await request(
  `/api/v1/cases/${correctionCase.case.id}/workflow/validate`,
  {
    method: "POST",
    token: admin,
    json: { expectedVersion: correctionStart.rowVersion },
  },
);
await request(`/api/v1/workflow/tasks/${correctionValidation.task.id}/claim`, {
  method: "POST",
  token: reviewer,
  json: { taskVersion: correctionValidation.task.rowVersion },
});
workflow = await currentWorkflow(correctionCase.case.id, reviewer);
const correctionReview = await request(
  `/api/v1/workflow/tasks/${correctionValidation.task.id}/submit-review`,
  {
    method: "POST",
    token: reviewer,
    json: {
      workflowVersion: workflow.rowVersion,
      taskVersion: correctionValidation.task.rowVersion + 1,
      outcome: "CORRECTION_REQUIRED",
      reasonCodes: ["INCOMPLETE_INFORMATION"],
      rationale: "A governed correction cycle is required.",
      evidenceVersionIds: workflow.validations[0].evidenceSnapshot.map(
        (item) => item.evidenceVersionId,
      ),
    },
  },
);
assert.equal(correctionReview.workflow.state, "CORRECTION_REQUESTED");
const resubmitted = await request(
  `/api/v1/cases/${correctionCase.case.id}/workflow/resubmit`,
  {
    method: "POST",
    token: admin,
    json: { expectedVersion: correctionReview.workflow.rowVersion },
  },
);
assert.equal(resubmitted.validationRun.runNumber, 2);
assert.equal(resubmitted.workflow.state, "READY_FOR_REVIEW");

for (const path of [
  "/health/ready",
  "/api/v1/cases?search=Phase%204",
  `/api/v1/cases/${primary.case.id}/workflow`,
]) {
  await request(path, { token: path.startsWith("/api/") ? admin : undefined });
}

console.log("PASS Phase 4 Workflow Docker end-to-end validation");
