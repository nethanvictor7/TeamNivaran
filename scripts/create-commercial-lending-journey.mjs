import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const base = process.env.CDEP_BASE_URL?.replace(/\/+$/, "");
const targetEnvironment = process.env.CDEP_TARGET_ENVIRONMENT;
const sharedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const syntheticAck = process.env.CDEP_SYNTHETIC_DATA_ACK;
const productionAck = process.env.CDEP_PRODUCTION_WRITE_ACK;
const includeAi = process.env.CDEP_INCLUDE_AI !== "false";

assert(base, "CDEP_BASE_URL is required; no default target is permitted.");
assert(
  ["development", "staging", "production"].includes(targetEnvironment),
  "CDEP_TARGET_ENVIRONMENT must be development, staging, or production.",
);
assert(
  syntheticAck === "YES",
  "Set CDEP_SYNTHETIC_DATA_ACK=YES to acknowledge persistent synthetic records.",
);
if (targetEnvironment === "production") {
  assert(
    productionAck === "CREATE_SYNTHETIC_COMMERCIAL_LENDING_JOURNEY",
    "Production writes require CDEP_PRODUCTION_WRITE_ACK=CREATE_SYNTHETIC_COMMERCIAL_LENDING_JOURNEY.",
  );
}
const credentials = {
  admin: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@cdep.local",
    password: process.env.CDEP_ADMIN_PASSWORD ?? sharedPassword,
  },
  reviewer: {
    email: process.env.BOOTSTRAP_REVIEWER_EMAIL ?? "reviewer@cdep.local",
    password: process.env.CDEP_REVIEWER_PASSWORD ?? sharedPassword,
  },
  approver: {
    email: process.env.BOOTSTRAP_APPROVER_EMAIL ?? "approver@cdep.local",
    password: process.env.CDEP_APPROVER_PASSWORD ?? sharedPassword,
  },
  auditor: {
    email: process.env.BOOTSTRAP_AUDITOR_EMAIL ?? "auditor@cdep.local",
    password: process.env.CDEP_AUDITOR_PASSWORD ?? sharedPassword,
  },
};
assert(
  Object.values(credentials).every((item) => item.password),
  "Provide role-specific CDEP_*_PASSWORD values or BOOTSTRAP_ADMIN_PASSWORD. Passwords are never printed.",
);

const suffix =
  process.env.CDEP_SCENARIO_KEY ??
  new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .slice(0, 14);
const externalReference = `SYNTH-CL-${suffix}`;
const state = {
  caseId: null,
  evidence: [],
  evidenceProofs: [],
  assessmentId: null,
  decisionId: null,
  decisionProofId: null,
  reportId: null,
};

function step(name, details = {}) {
  console.log(JSON.stringify({ step: name, ...details }));
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
  const responseBody = contentType.includes("json")
    ? await response.json()
    : await response.arrayBuffer();
  assert(
    expected.includes(response.status),
    `${init.method ?? "GET"} ${path}: expected ${expected.join("/")} but got ${
      response.status
    }: ${
      responseBody instanceof ArrayBuffer
        ? `<${responseBody.byteLength} bytes>`
        : JSON.stringify(responseBody)
    }`,
  );
  return responseBody;
}

async function waitFor(description, operation, predicate, timeoutMs = 240_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${description} timed out: ${JSON.stringify(last)}`);
}

async function login({ email, password }) {
  const result = await request("/api/v1/auth/login", {
    method: "POST",
    json: { email, password },
  });
  assert(result.accessToken, `Login failed for ${email}.`);
  assert(result.identity?.userId, `Login returned no identity for ${email}.`);
  return result;
}

function evidenceForm(item, reason = "INITIAL") {
  const bytes = Buffer.from(`${item.content.trim()}\n`, "utf8");
  const form = new FormData();
  form.append("classificationCode", item.classificationCode);
  form.append("title", item.title);
  form.append("description", item.description);
  form.append("declaredSizeBytes", String(bytes.byteLength));
  form.append("reason", reason);
  form.append("file", new Blob([bytes], { type: "text/plain" }), item.filename);
  return form;
}

async function waitForEvidence(evidenceId, token, versionNumber = 1) {
  return waitFor(
    `Evidence ${evidenceId} version ${versionNumber} availability`,
    () => request(`/api/v1/evidence/${evidenceId}`, { token }),
    (item) =>
      item.status === "ACTIVE" &&
      item.currentVersion?.versionNumber === versionNumber &&
      item.currentVersion?.processingStatus === "AVAILABLE" &&
      /^[a-f0-9]{64}$/.test(item.currentVersion?.sha256 ?? ""),
  );
}

async function verifyIntegrity(evidence, token) {
  const check = await request(
    `/api/v1/evidence/${evidence.id}/versions/${evidence.currentVersion.id}/integrity-checks`,
    { method: "POST", expected: [202], token },
  );
  await waitFor(
    `Evidence ${evidence.id} integrity check`,
    () =>
      request(`/api/v1/evidence/${evidence.id}/integrity-checks`, {
        token,
      }),
    (checks) =>
      checks.some((item) => item.id === check.id && item.status === "MATCH"),
  );
}

async function anchorEvidenceVersion(evidenceId, versionId, token, key) {
  const path = `/api/v1/evidence/${evidenceId}/versions/${versionId}/proofs`;
  const queued = await request(path, {
    method: "POST",
    expected: [202],
    token,
    headers: { "idempotency-key": key },
    json: {},
  });
  assert.equal(queued.status, "PENDING");
  assert.equal(queued.providerType, "FABRIC");
  const proofs = await waitFor(
    `Fabric proof ${queued.id}`,
    () => request(path, { token }),
    (items) =>
      items.some(
        (item) =>
          item.id === queued.id &&
          item.state === "CONFIRMED" &&
          item.binding?.providerTransactionId,
      ),
  );
  const proof = proofs.find((item) => item.id === queued.id);
  const verification = await request(`${path}/verify`, {
    method: "POST",
    token,
    json: {},
  });
  assert.equal(verification.offLedgerStatus, "OFF_LEDGER_HASH_MATCH");
  assert.equal(verification.ledgerProofStatus, "LEDGER_PROOF_CONFIRMED");
  assert.equal(verification.ledgerHashStatus, "LEDGER_HASH_MATCH");
  state.evidenceProofs.push({
    evidenceId,
    evidenceVersionId: versionId,
    proofId: queued.proofId,
    transactionId: proof.binding.providerTransactionId,
  });
  return proof;
}

async function currentWorkflow(caseId, token) {
  const result = await request(`/api/v1/cases/${caseId}/workflow`, { token });
  assert(result.items.length > 0, "The case has no workflow cycle.");
  return result.items[0];
}

async function completedArtifact(path, token) {
  return waitFor(
    `Artifact ${path}`,
    () => request(path, { token }),
    (item) => ["COMPLETED", "FAILED"].includes(item.state),
  );
}

const evidenceFixtures = [
  {
    key: "application",
    classificationCode: "APPLICATION_FORM",
    title: "Commercial lending application",
    description:
      "Signed synthetic facility application and borrower declaration.",
    filename: "commercial-lending-application.txt",
    content: `
SYNTHETIC TEST RECORD — NOT A REAL CUSTOMER
Applicant: Northstar Precision Components Ltd
Facility: GBP 2,400,000 revolving credit facility
Purpose: Working capital for confirmed aerospace component orders
Term requested: 36 months
Repayment source: Operating cash flow and receivables collection
Annual turnover: GBP 12,850,000
Employees: 74
Applicant declaration: Information supplied for controlled platform testing only.
`,
  },
  {
    key: "identity",
    classificationCode: "IDENTITY",
    title: "KYC and beneficial ownership review",
    description:
      "Synthetic company, director, ownership, sanctions and PEP checks.",
    filename: "kyc-beneficial-ownership.txt",
    content: `
SYNTHETIC TEST RECORD — NOT A REAL CUSTOMER
Entity: Northstar Precision Components Ltd
Registration: SYNTH-08927411
Registered office: 100 Test Foundry Road, Birmingham, B00 0AA
Beneficial owner: Elena Hart (62 percent) — synthetic identity
Second owner: Martin Cole (38 percent) — synthetic identity
Sanctions screening: No match
PEP screening: No match
Adverse media: No material match
KYC outcome: Complete; enhanced review not required
`,
  },
  {
    key: "income",
    classificationCode: "INCOME",
    title: "Management accounts and cash-flow forecast",
    description:
      "Synthetic historical performance and forward debt-service capacity.",
    filename: "management-accounts-cashflow.txt",
    content: `
SYNTHETIC TEST RECORD — VALUES ARE ILLUSTRATIVE
FY2024 revenue: GBP 10,920,000; EBITDA: GBP 1,420,000
FY2025 revenue: GBP 11,760,000; EBITDA: GBP 1,570,000
FY2026 forecast revenue: GBP 12,850,000; EBITDA: GBP 1,760,000
Existing senior debt: GBP 820,000
Forecast interest cover: 4.1x
Forecast debt service coverage ratio: 1.72x
Customer concentration: Largest customer 24 percent of revenue
Accountant status: Management-prepared; year-end figures reconciled
`,
  },
  {
    key: "bank-statement",
    classificationCode: "BANK_STATEMENT",
    title: "Operating account statement analysis",
    description:
      "Synthetic six-month operating account activity and conduct review.",
    filename: "operating-account-analysis-v1.txt",
    content: `
SYNTHETIC TEST RECORD — NO REAL BANK ACCOUNT
Review period: January to June 2026
Average collected balance: GBP 486,000
Average monthly credits: GBP 1,068,000
Returned items: 0
Unauthorised overdraft days: 0
Largest single debit: GBP 214,000 payroll and tax
Initial analyst note: June closing balance recorded as GBP 421,800.
`,
  },
  {
    key: "credit-report",
    classificationCode: "CREDIT_REPORT",
    title: "Commercial credit bureau report",
    description:
      "Synthetic bureau score, payment performance and public-record checks.",
    filename: "commercial-credit-report.txt",
    content: `
SYNTHETIC TEST RECORD — NOT A REAL CREDIT SEARCH
Commercial score: 78 of 100
Probability of default band: Low to moderate
County court judgments: 0
Insolvency notices: 0
Average payment performance: 9 days beyond terms
Trade lines reporting: 12
Material arrears: None
Search outcome: Acceptable subject to normal policy controls
`,
  },
  {
    key: "collateral",
    classificationCode: "COLLATERAL",
    title: "Receivables and equipment collateral review",
    description:
      "Synthetic collateral schedule, valuation and eligibility analysis.",
    filename: "collateral-review.txt",
    content: `
SYNTHETIC TEST RECORD — VALUES ARE ILLUSTRATIVE
Eligible receivables: GBP 3,180,000
Proposed advance rate: 70 percent
Receivables availability: GBP 2,226,000
Equipment orderly liquidation value: GBP 640,000
Prior ranking charges: GBP 250,000
Concentration reserve: GBP 180,000
Collateral conclusion: Supports requested facility with normal controls.
`,
  },
  {
    key: "correspondence",
    classificationCode: "CORRESPONDENCE",
    title: "Credit clarification record",
    description: "Synthetic borrower responses to underwriting questions.",
    filename: "credit-clarifications.txt",
    content: `
SYNTHETIC TEST RECORD — NOT REAL CORRESPONDENCE
Question: Explain forecast revenue growth.
Response: Two signed framework orders begin delivery in Q4 2026.
Question: Explain customer concentration.
Response: Largest customer share is forecast to fall from 24 to 19 percent.
Question: Confirm insurance.
Response: Asset and business interruption cover confirmed through 30 June 2027.
Recorded outcome: Clarifications accepted for independent human review.
`,
  },
];

async function main() {
  step("preflight", { base, targetEnvironment, includeAi });
  const health = await request("/health/ready");
  assert.equal(health.status, "ok", "Gateway is not ready.");

  const [admin, reviewer, approver, auditor] = await Promise.all(
    Object.values(credentials).map(login),
  );
  assert.equal(
    admin.identity.organizationId,
    reviewer.identity.organizationId,
    "Admin and reviewer are not in the same organization.",
  );
  assert.equal(
    admin.identity.organizationId,
    approver.identity.organizationId,
    "Admin and approver are not in the same organization.",
  );

  const network = await request("/api/v1/ledger/network/status", {
    token: admin.accessToken,
  });
  assert.equal(network.providerType, "FABRIC");
  assert.equal(network.state, "AVAILABLE");

  let governance = null;
  if (includeAi) {
    governance = await request("/api/v1/ai-governance", {
      token: admin.accessToken,
    });
    if (
      targetEnvironment === "production" &&
      governance.adapterMode === "MOCK"
    ) {
      throw new Error(
        "Refusing production journey: AI governance reports MOCK. Configure the approved production adapter or rerun with CDEP_INCLUDE_AI=false.",
      );
    }
  }

  const decisionDueAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const matchingCases = await request(
    `/api/v1/cases?search=${encodeURIComponent(externalReference)}&pageSize=100`,
    { token: admin.accessToken },
  );
  const existingCase = matchingCases.items.find(
    (item) => item.externalReference === externalReference,
  );
  const created =
    existingCase ??
    (await request("/api/v1/cases", {
      method: "POST",
      expected: [201],
      token: admin.accessToken,
      headers: { "idempotency-key": `commercial-case-${suffix}` },
      json: {
        caseType: "COMMERCIAL_CREDIT",
        title: `Northstar Precision Components — synthetic RCF ${suffix}`,
        priority: "HIGH",
        requestedAmountMinor: 240_000_000,
        currency: "GBP",
        externalReference,
        decisionDueAt,
      },
    }));
  state.caseId = created.id;
  step(existingCase ? "case-resumed" : "case-created", {
    caseId: created.id,
    externalReference,
  });

  const parties = [
    {
      partyType: "BORROWER",
      displayName: "Northstar Precision Components Ltd (synthetic)",
      externalReference: `SYNTH-BORROWER-${suffix}`,
    },
    {
      partyType: "GUARANTOR",
      displayName: "Elena Hart (synthetic guarantor)",
      externalReference: `SYNTH-GUARANTOR-${suffix}`,
    },
    {
      partyType: "DIRECTOR",
      displayName: "Martin Cole (synthetic director)",
      externalReference: `SYNTH-DIRECTOR-${suffix}`,
    },
  ];
  let currentCase = await request(`/api/v1/cases/${created.id}`, {
    token: admin.accessToken,
  });
  for (const party of parties) {
    if (
      !(currentCase.parties ?? []).some(
        (item) => item.externalReference === party.externalReference,
      )
    ) {
      await request(`/api/v1/cases/${created.id}/parties`, {
        method: "POST",
        expected: [201],
        token: admin.accessToken,
        json: party,
      });
    }
  }
  currentCase = await request(`/api/v1/cases/${created.id}`, {
    token: admin.accessToken,
  });
  for (const assignment of [
    { userId: reviewer.identity.userId, role: "REVIEWER" },
    { userId: approver.identity.userId, role: "OBSERVER" },
  ]) {
    if (
      !(currentCase.assignments ?? []).some(
        (item) =>
          item.userId === assignment.userId && item.role === assignment.role,
      )
    ) {
      await request(`/api/v1/cases/${created.id}/assignments`, {
        method: "POST",
        expected: [201],
        token: admin.accessToken,
        json: assignment,
      });
    }
  }

  currentCase = await request(`/api/v1/cases/${created.id}`, {
    token: admin.accessToken,
  });
  const opened =
    currentCase.status === "DRAFT"
      ? await request(`/api/v1/cases/${created.id}`, {
          method: "PATCH",
          token: admin.accessToken,
          json: { version: currentCase.version, status: "OPEN" },
        })
      : currentCase;
  assert(
    ["OPEN", "EVIDENCE_COLLECTION", "UNDER_REVIEW"].includes(opened.status),
    `Case cannot resume from ${opened.status}.`,
  );
  step("case-active", {
    status: opened.status,
    parties: parties.length,
    assignments: 2,
  });

  const currentEvidence = await request(
    `/api/v1/cases/${created.id}/evidence?pageSize=100`,
    { token: admin.accessToken },
  );
  for (const fixture of evidenceFixtures) {
    const existingEvidence = currentEvidence.items.find(
      (item) =>
        item.title === fixture.title &&
        item.classificationCode === fixture.classificationCode,
    );
    const uploaded =
      existingEvidence ??
      (await request(`/api/v1/cases/${created.id}/evidence`, {
        method: "POST",
        expected: [202],
        token: admin.accessToken,
        headers: {
          "idempotency-key": `commercial-evidence-${fixture.key}-${suffix}`,
        },
        body: evidenceForm(fixture),
      }));
    const evidenceDetail = existingEvidence
      ? await request(`/api/v1/evidence/${uploaded.id}`, {
          token: admin.accessToken,
        })
      : uploaded;
    const latestVersionNumber =
      evidenceDetail.currentVersion?.versionNumber ?? 1;
    const available = await waitForEvidence(
      uploaded.id,
      admin.accessToken,
      latestVersionNumber,
    );
    await verifyIntegrity(available, admin.accessToken);
    state.evidence.push({
      key: fixture.key,
      id: available.id,
      versionId: available.currentVersion.id,
      versionNumber: available.currentVersion.versionNumber,
      sha256: available.currentVersion.sha256,
    });
    step("evidence-available", {
      classificationCode: fixture.classificationCode,
      evidenceId: available.id,
      version: available.currentVersion.versionNumber,
    });
  }

  const bank = state.evidence.find((item) => item.key === "bank-statement");
  const bankVersions = await request(`/api/v1/evidence/${bank.id}/versions`, {
    token: admin.accessToken,
  });
  const bankV1 = bankVersions.find((item) => item.versionNumber === 1);
  assert(bankV1, "The original bank-statement version is missing.");
  await anchorEvidenceVersion(
    bank.id,
    bankV1.id,
    admin.accessToken,
    `commercial-proof-bank-v1-${suffix}`,
  );
  const bankFixture = evidenceFixtures.find(
    (item) => item.key === "bank-statement",
  );
  const replacementFixture = {
    ...bankFixture,
    filename: "operating-account-analysis-v2.txt",
    content: `${bankFixture.content}
Correction event:
The June closing balance was reconciled to GBP 431,800.
The original GBP 421,800 value was a transcription error.
Reviewer impact: Immaterial to affordability and policy outcome.
`,
  };
  if (bank.versionNumber === 1) {
    await request(`/api/v1/evidence/${bank.id}/versions`, {
      method: "POST",
      expected: [202],
      token: admin.accessToken,
      headers: { "idempotency-key": `commercial-bank-v2-${suffix}` },
      body: evidenceForm(replacementFixture, "REPLACEMENT"),
    });
  }
  const bankV2 = await waitForEvidence(bank.id, admin.accessToken, 2);
  await verifyIntegrity(bankV2, admin.accessToken);
  bank.versionId = bankV2.currentVersion.id;
  bank.versionNumber = 2;
  bank.sha256 = bankV2.currentVersion.sha256;
  step("evidence-replaced", {
    evidenceId: bank.id,
    previousVersion: 1,
    currentVersion: 2,
  });

  for (const evidence of state.evidence) {
    await anchorEvidenceVersion(
      evidence.id,
      evidence.versionId,
      admin.accessToken,
      `commercial-proof-${evidence.key}-v${evidence.versionNumber}-${suffix}`,
    );
    step("evidence-anchored", {
      evidenceId: evidence.id,
      version: evidence.versionNumber,
    });
  }

  let workflowResponse = await request(`/api/v1/cases/${created.id}/workflow`, {
    token: admin.accessToken,
  });
  let workflow = workflowResponse.items[0] ?? null;
  if (!workflow) {
    const started = await request(
      `/api/v1/cases/${created.id}/workflow/start`,
      {
        method: "POST",
        expected: [201],
        token: admin.accessToken,
        headers: { "idempotency-key": `commercial-workflow-${suffix}` },
        json: {},
      },
    );
    const validated = await request(
      `/api/v1/cases/${created.id}/workflow/validate`,
      {
        method: "POST",
        token: admin.accessToken,
        json: { expectedVersion: started.rowVersion },
      },
    );
    assert.equal(validated.validationRun.status, "PASS");
    assert.equal(validated.workflow.state, "READY_FOR_REVIEW");
    workflow = validated.workflow;
  }

  let reviewTask = workflow.tasks.find(
    (task) =>
      task.taskType === "REVIEW_CASE" &&
      ["PENDING", "CLAIMED"].includes(task.status),
  );
  assert(reviewTask, "The active review task is missing.");
  if (workflow.state === "READY_FOR_REVIEW") {
    await request(`/api/v1/workflow/tasks/${reviewTask.id}/claim`, {
      method: "POST",
      token: reviewer.accessToken,
      json: { taskVersion: reviewTask.rowVersion },
    });
  }
  workflow = await currentWorkflow(created.id, reviewer.accessToken);
  assert.equal(workflow.state, "UNDER_REVIEW");
  reviewTask = workflow.tasks.find(
    (task) =>
      task.taskType === "REVIEW_CASE" &&
      ["PENDING", "CLAIMED"].includes(task.status),
  );
  assert(reviewTask, "The claimed review task is missing.");
  step("review-started", { workflowId: workflow.id });

  let supportingAssessmentIds = [];
  if (includeAi) {
    const policy =
      governance.modelPolicies.find(
        (item) => item.code === "PLATFORM_REVIEW_SUPPORT" && item.enabled,
      ) ?? governance.modelPolicies.find((item) => item.enabled);
    assert(policy?.id, "No enabled model policy is available.");
    const queued = await request(`/api/v1/cases/${created.id}/ai-assessments`, {
      method: "POST",
      expected: [202],
      token: admin.accessToken,
      headers: { "idempotency-key": `commercial-ai-${suffix}` },
      json: {
        modelPolicyId: policy.id,
        purpose:
          "Independent decision support for a synthetic commercial lending review",
        expectedWorkflowVersion: workflow.rowVersion,
      },
    });
    const assessment = await waitFor(
      `AI assessment ${queued.id}`,
      () =>
        request(`/api/v1/ai-assessments/${queued.id}`, {
          token: reviewer.accessToken,
        }),
      (item) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(item.status),
    );
    assert.equal(assessment.status, "SUCCEEDED");
    assert(assessment.output?.findings?.length > 0);
    await request(`/api/v1/ai-assessments/${assessment.id}/feedback`, {
      method: "POST",
      expected: [201],
      token: reviewer.accessToken,
      json: {
        rating: "HELPFUL",
        comment: "Synthetic scenario reviewed by the assigned human reviewer.",
      },
    });
    const accepted = await request(
      `/api/v1/ai-assessments/${assessment.id}/acceptance`,
      {
        method: "POST",
        expected: [201],
        token: reviewer.accessToken,
        json: {
          expectedWorkflowVersion: workflow.rowVersion,
          selectedItems: [
            {
              itemType: "FINDING",
              itemCode: assessment.output.findings[0].code,
            },
          ],
        },
      },
    );
    assert(accepted.workflowDraftId);
    state.assessmentId = assessment.id;
    supportingAssessmentIds = [assessment.id];
    workflow = await currentWorkflow(created.id, reviewer.accessToken);
    step("ai-assessment-reviewed", {
      assessmentId: assessment.id,
      adapterMode: governance.adapterMode,
    });
  }

  const evidenceVersionIds = workflow.validations[0].evidenceSnapshot.map(
    (item) => item.evidenceVersionId,
  );
  const review = await request(
    `/api/v1/workflow/tasks/${reviewTask.id}/submit-review`,
    {
      method: "POST",
      token: reviewer.accessToken,
      json: {
        workflowVersion: workflow.rowVersion,
        taskVersion: reviewTask.rowVersion,
        outcome: "READY_FOR_RECOMMENDATION",
        reasonCodes: [
          "AFFORDABILITY_CONFIRMED",
          "KYC_COMPLETE",
          "COLLATERAL_SUPPORTS_EXPOSURE",
        ],
        rationale:
          "Revenue, debt-service capacity, account conduct, KYC and collateral were independently reviewed. The corrected statement balance is immaterial. Recommend normal commercial covenants and quarterly reporting.",
        evidenceVersionIds,
      },
    },
  );
  assert.equal(review.workflow.state, "READY_FOR_RECOMMENDATION");

  workflow = await currentWorkflow(created.id, admin.accessToken);
  const recommendation = await request(
    `/api/v1/cases/${created.id}/recommendations`,
    {
      method: "POST",
      token: admin.accessToken,
      json: {
        workflowVersion: workflow.rowVersion,
        outcome: "RECOMMEND_APPROVAL",
        reasonCodes: [
          "CASH_FLOW_SUPPORT",
          "ACCEPTABLE_ACCOUNT_CONDUCT",
          "COLLATERAL_COVERAGE",
        ],
        rationale:
          "Recommend a GBP 2.4m revolving facility for 36 months. Independent human review confirms acceptable affordability, account conduct and collateral support.",
        conditions: [
          "Quarterly management accounts within 30 days of quarter end.",
          "Minimum debt service coverage ratio of 1.35x.",
          "Eligible receivables borrowing-base certificate each month.",
          "No dividend distribution while a covenant breach is outstanding.",
        ],
        supportingAssessmentIds,
      },
    },
  );
  assert.equal(recommendation.workflow.state, "DECISION_PENDING");
  step("recommendation-submitted");

  workflow = await currentWorkflow(created.id, approver.accessToken);
  const approvalTask = workflow.tasks.find(
    (task) =>
      task.taskType === "APPROVE_DECISION" &&
      ["PENDING", "CLAIMED"].includes(task.status),
  );
  assert(approvalTask, "Approval task is missing.");
  const finalDecision = await request(
    `/api/v1/cases/${created.id}/decision/approve`,
    {
      method: "POST",
      expected: [201],
      token: approver.accessToken,
      headers: { "idempotency-key": `commercial-decision-${suffix}` },
      json: {
        workflowVersion: workflow.rowVersion,
        taskVersion: approvalTask.rowVersion,
        reasonCodes: [
          "APPROVED_WITH_COVENANTS",
          "INDEPENDENT_APPROVAL_COMPLETE",
        ],
        rationale:
          "Approved by the independent decision authority after reviewing the complete evidence snapshot, reviewer rationale, recommendation and applicable controls.",
      },
    },
  );
  assert.equal(finalDecision.workflow.state, "APPROVED");
  assert.equal(finalDecision.decision.outcome, "APPROVED");
  state.decisionId = finalDecision.decision.id;
  step("decision-approved", { decisionId: state.decisionId });

  const decisionProofPath = `/api/v1/cases/${created.id}/decision-proof`;
  const queuedDecisionProof = await request(decisionProofPath, {
    method: "POST",
    expected: [202],
    token: approver.accessToken,
    headers: { "idempotency-key": `commercial-decision-proof-${suffix}` },
    json: {},
  });
  const decisionProof = await waitFor(
    `Decision proof ${queuedDecisionProof.id}`,
    () => request(decisionProofPath, { token: approver.accessToken }),
    (item) =>
      item.id === queuedDecisionProof.id &&
      item.state === "CONFIRMED" &&
      item.binding?.providerTransactionId,
  );
  const decisionVerification = await request(`${decisionProofPath}/verify`, {
    method: "POST",
    token: approver.accessToken,
    json: {},
  });
  assert.equal(decisionVerification.offLedgerStatus, "OFF_LEDGER_HASH_MATCH");
  assert.equal(
    decisionVerification.ledgerProofStatus,
    "LEDGER_PROOF_CONFIRMED",
  );
  assert.equal(decisionVerification.ledgerHashStatus, "LEDGER_HASH_MATCH");
  state.decisionProofId = queuedDecisionProof.proofId;
  step("decision-proof-confirmed", {
    proofId: state.decisionProofId,
    transactionId: decisionProof.binding.providerTransactionId,
  });

  const reconciliation = await request("/api/v1/ledger/reconciliation/run", {
    method: "POST",
    expected: [201],
    token: admin.accessToken,
    json: {},
  });
  assert.equal(reconciliation.status, "COMPLETED");

  const journey = await waitFor(
    "Audit journey projection",
    () =>
      request(`/api/v1/audit/cases/${created.id}/journey`, {
        token: auditor.accessToken,
      }),
    (item) => item.items?.length >= 12,
  );
  const chain = await request("/api/v1/audit/chain/verify?limit=5000", {
    token: auditor.accessToken,
  });
  assert.equal(chain.status, "VERIFIED");

  const report = await request("/api/v1/audit/reports", {
    method: "POST",
    expected: [202],
    token: auditor.accessToken,
    headers: { "idempotency-key": `commercial-dossier-${suffix}` },
    json: {
      reportKey: "CASE_DECISION_DOSSIER",
      parameters: { caseId: created.id },
    },
  });
  state.reportId = report.id;
  const completedReport = await completedArtifact(
    `/api/v1/audit/reports/${report.id}`,
    auditor.accessToken,
  );
  assert.equal(completedReport.state, "COMPLETED");
  assert(/^[a-f0-9]{64}$/.test(completedReport.checksumSha256));

  const grant = await request(`/api/v1/audit/reports/${report.id}/download`, {
    token: auditor.accessToken,
  });
  const reportResponse = await fetch(grant.url);
  assert(
    reportResponse.ok,
    `Dossier download returned HTTP ${reportResponse.status}.`,
  );
  const reportArtifact = Buffer.from(await reportResponse.arrayBuffer());
  assert.equal(
    createHash("sha256").update(reportArtifact).digest("hex"),
    completedReport.checksumSha256,
  );

  const timeline = await request(`/api/v1/cases/${created.id}/timeline`, {
    token: admin.accessToken,
  });
  const caseDetail = await waitFor(
    "Terminal Case synchronization",
    () =>
      request(`/api/v1/cases/${created.id}`, {
        token: admin.accessToken,
      }),
    (item) => item.status === "DECIDED",
  );
  assert.equal(caseDetail.status, "DECIDED");

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        targetEnvironment,
        scenario: "Synthetic commercial lending end-to-end journey",
        caseId: created.id,
        externalReference,
        borrower: "Northstar Precision Components Ltd (synthetic)",
        requestedFacility: { amountMinor: 240_000_000, currency: "GBP" },
        parties: parties.length,
        evidenceAssets: state.evidence.length,
        authoritativeEvidenceVersions: state.evidence.map((item) => ({
          classification: evidenceFixtures.find(
            (fixture) => fixture.key === item.key,
          ).classificationCode,
          evidenceId: item.id,
          versionId: item.versionId,
          versionNumber: item.versionNumber,
        })),
        fabricEvidenceProofs: state.evidenceProofs.length,
        assessmentId: state.assessmentId,
        decisionId: state.decisionId,
        decisionProofId: state.decisionProofId,
        auditEvents: journey.items.length,
        caseTimelineEntries: timeline.length,
        auditChain: chain.status,
        dossierReportId: state.reportId,
        dossierChecksumSha256: completedReport.checksumSha256,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        result: "FAILED",
        message: error instanceof Error ? error.message : String(error),
        persistentRecordsCreated: state,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
