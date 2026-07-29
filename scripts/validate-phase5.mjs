import assert from "node:assert/strict";

const base = process.env.CDEP_BASE_URL ?? "http://api-gateway:3000";
const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@cdep.local";
const outsiderEmail =
  process.env.BOOTSTRAP_OUTSIDER_EMAIL ?? "outsider@cdep.local";
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
assert(password, "Phase 5 validator requires BOOTSTRAP_ADMIN_PASSWORD.");
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
  return { response, body: result };
}
async function login(loginEmail) {
  const { body } = await request("/api/v1/auth/login", {
    method: "POST",
    json: { email: loginEmail, password },
  });
  check(Boolean(body.accessToken), `Login failed for ${loginEmail}.`);
  return body.accessToken;
}
async function waitFor(description, operation, predicate, timeout = 180_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`${description} timed out: ${JSON.stringify(last)}`);
}
function textEvidence(suffix) {
  const bytes = Buffer.from(
    `CDEP controlled application ${suffix}\nRequested facility evidence is present.\nHuman verification is required.\n`,
  );
  const form = new FormData();
  form.append("classificationCode", "APPLICATION_FORM");
  form.append("title", "Controlled application record");
  form.append("description", "Phase 5 deterministic text fixture");
  form.append("declaredSizeBytes", String(bytes.length));
  form.append("reason", "INITIAL");
  form.append(
    "file",
    new Blob([bytes], { type: "text/plain" }),
    "application.txt",
  );
  return form;
}
async function assessment(id, token) {
  return (await request(`/api/v1/ai-assessments/${id}`, { token })).body;
}

const suffix = String(Date.now());
const [admin, outsider] = await Promise.all([
  login(email),
  login(outsiderEmail),
]);
const health = await request("/health/ready");
check(health.body.status === "ok", "Gateway readiness failed.");
check(
  health.body.dependencies.aiAssessmentService === "up",
  "AI service is absent from Gateway readiness.",
);
await request("/api/v1/ai-governance", { expected: [401] });
assertions += 1;
const governance = (await request("/api/v1/ai-governance", { token: admin }))
  .body;
check(governance.adapterMode === "MOCK", "Adapter mode is not MOCK.");
check(
  governance.liveCortex === "DEFERRED_UNVERIFIED",
  "Live Cortex deferral is not explicit.",
);
check(governance.runtimeConfigs.length >= 1, "Runtime config seed is missing.");
check(governance.modelPolicies.length >= 1, "Model policy seed is missing.");
check(governance.promptTemplates.length >= 1, "Prompt seed is missing.");
check(
  governance.runtimeConfigs.every((item) => !("endpoint" in item)),
  "Governance unexpectedly exposes a provider endpoint.",
);
const [runtimeConfigurations, modelPolicies, promptTemplates] =
  await Promise.all([
    request("/api/v1/ai-governance/cortex-configurations", { token: admin }),
    request("/api/v1/ai-governance/model-policies", { token: admin }),
    request("/api/v1/ai-governance/prompt-templates", { token: admin }),
  ]);
check(
  runtimeConfigurations.body.length >= 1,
  "Explicit Cortex configuration route is unavailable.",
);
check(
  modelPolicies.body.length >= 1,
  "Explicit model-policy route is unavailable.",
);
check(
  promptTemplates.body.length >= 1,
  "Explicit prompt-template route is unavailable.",
);
const selfTest = (
  await request(
    `/api/v1/ai-governance/cortex-configurations/${runtimeConfigurations.body[0].id}/test`,
    { method: "POST", token: admin, json: {} },
  )
).body;
check(
  selfTest.adapterMode === "MOCK" &&
    selfTest.executionMode === "MOCK_SYNCHRONOUS" &&
    selfTest.isSynthetic === true,
  "Mock Cortex self-test metadata is unsafe or incomplete.",
);

const created = (
  await request("/api/v1/cases", {
    method: "POST",
    expected: [201],
    token: admin,
    headers: { "idempotency-key": `phase5-case-${suffix}` },
    json: {
      caseType: "COMMERCIAL_CREDIT",
      title: `Phase 5 assessment case ${suffix}`,
      priority: "NORMAL",
      requestedAmountMinor: 3250000,
      currency: "GBP",
      externalReference: `AI-${suffix}`,
    },
  })
).body;
check(Boolean(created.id), "Case was not created.");
const opened = (
  await request(`/api/v1/cases/${created.id}`, {
    method: "PATCH",
    token: admin,
    json: { version: created.version, status: "OPEN" },
  })
).body;
check(opened.status === "OPEN", "Case was not opened.");
const uploaded = (
  await request(`/api/v1/cases/${created.id}/evidence`, {
    method: "POST",
    expected: [202],
    token: admin,
    headers: { "idempotency-key": `phase5-evidence-${suffix}` },
    body: textEvidence(suffix),
  })
).body;
const evidence = await waitFor(
  "text Evidence availability",
  async () =>
    (await request(`/api/v1/evidence/${uploaded.id}`, { token: admin })).body,
  (item) =>
    item.status === "ACTIVE" &&
    item.currentVersion?.processingStatus === "AVAILABLE",
);
check(
  evidence.currentVersion.detectedMediaType === "text/plain",
  "Text Evidence media type was not preserved.",
);
check(
  /^[a-f0-9]{64}$/.test(evidence.currentVersion.sha256),
  "Evidence SHA-256 is missing.",
);
const started = (
  await request(`/api/v1/cases/${created.id}/workflow/start`, {
    method: "POST",
    expected: [201],
    token: admin,
    headers: { "idempotency-key": `phase5-workflow-${suffix}` },
    json: {},
  })
).body;
const validated = (
  await request(`/api/v1/cases/${created.id}/workflow/validate`, {
    method: "POST",
    token: admin,
    json: { expectedVersion: started.rowVersion },
  })
).body;
check(validated.validationRun.status === "PASS", "Workflow validation failed.");
check(
  validated.workflow.state === "READY_FOR_REVIEW",
  "Workflow is not assessment-eligible.",
);
await request(`/api/v1/workflow/tasks/${validated.task.id}/claim`, {
  method: "POST",
  token: admin,
  json: { taskVersion: validated.task.rowVersion },
});
await new Promise((resolve) => setTimeout(resolve, 1200));
const workflow = (
  await request(`/api/v1/cases/${created.id}/workflow`, { token: admin })
).body.items.find((item) => item.id === started.id);
check(
  workflow.state === "UNDER_REVIEW",
  "Review claim did not enter UNDER_REVIEW.",
);

const assessmentKey = `phase5-assessment-${suffix}`;
const queued = (
  await request(`/api/v1/cases/${created.id}/ai-assessments`, {
    method: "POST",
    expected: [202],
    token: admin,
    headers: { "idempotency-key": assessmentKey },
    json: {
      modelPolicyId: "50000000-0000-4000-8000-000000000004",
      purpose: "Controlled human review support",
      expectedWorkflowVersion: workflow.rowVersion,
    },
  })
).body;
check(queued.status === "QUEUED", "Assessment was not persisted as queued.");
const duplicate = (
  await request(`/api/v1/cases/${created.id}/ai-assessments`, {
    method: "POST",
    expected: [202],
    token: admin,
    headers: { "idempotency-key": assessmentKey },
    json: {
      modelPolicyId: "50000000-0000-4000-8000-000000000004",
      purpose: "Controlled human review support",
      expectedWorkflowVersion: workflow.rowVersion,
    },
  })
).body;
check(duplicate.id === queued.id, "Assessment request is not idempotent.");
await request(`/api/v1/cases/${created.id}/ai-assessments`, {
  method: "POST",
  expected: [409],
  token: admin,
  headers: { "idempotency-key": assessmentKey },
  json: {
    modelPolicyId: "50000000-0000-4000-8000-000000000004",
    purpose: "Different purpose",
  },
});
assertions += 1;
await request(`/api/v1/cases/${created.id}/ai-assessments`, {
  method: "POST",
  expected: [400],
  token: admin,
  headers: { "idempotency-key": `phase5-profile-injection-${suffix}` },
  json: {
    modelPolicyId: "50000000-0000-4000-8000-000000000004",
    purpose: "Profile injection must be rejected",
    mockProfile: "BAD_CITATION",
  },
});
assertions += 1;
const succeeded = await waitFor(
  "MockCortexGateway success",
  () => assessment(queued.id, admin),
  (item) => item.status === "SUCCEEDED",
);
check(
  succeeded.output.schemaVersion === "1.0",
  "Output schema was not normalized.",
);
check(
  succeeded.output.recommendation === "REVIEW_REQUIRED",
  "Mock output recommendation label changed.",
);
check(succeeded.output.findings.length >= 1, "Normalized finding is missing.");
check(succeeded.refs.length === 1, "Pinned Evidence reference is missing.");
check(
  succeeded.output.citations[0].evidenceVersionId ===
    succeeded.refs[0].evidenceVersionId,
  "Citation is not constrained to the pinned Evidence version.",
);
check(
  succeeded.prepared.byteCount > 0 &&
    succeeded.prepared.fingerprint === succeeded.inputFingerprint,
  "Prepared input fingerprint was not persisted.",
);
check(
  succeeded.executions[0].adapterMode === "MOCK",
  "Mock execution is missing.",
);
const operationsExecutions = (
  await request(`/api/v1/ai-assessments/${queued.id}/executions`, {
    token: admin,
  })
).body;
check(
  operationsExecutions[0].rawOutputStoredEncrypted === true,
  "Encrypted raw output was not verified through the operations view.",
);
check(
  !JSON.stringify(succeeded.output).includes("chain-of-thought"),
  "Output leaked hidden reasoning.",
);
await request(`/api/v1/ai-assessments/${queued.id}`, {
  token: outsider,
  expected: [404],
});
assertions += 1;
const feedback = (
  await request(`/api/v1/ai-assessments/${queued.id}/feedback`, {
    method: "POST",
    expected: [201],
    token: admin,
    json: { rating: "HELPFUL", comment: "Human-reviewed mock output." },
  })
).body;
check(feedback.rating === "HELPFUL", "Feedback was not persisted separately.");

const accepted = (
  await request(`/api/v1/ai-assessments/${queued.id}/acceptance`, {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      expectedWorkflowVersion: workflow.rowVersion,
      selectedItems: [
        {
          itemType: "FINDING",
          itemCode: succeeded.output.findings[0].code,
        },
      ],
    },
  })
).body;
check(Boolean(accepted.workflowDraftId), "Workflow draft was not created.");
check(
  accepted.items.length === 1,
  "Explicit acceptance item was not recorded.",
);
const workflowAfterAcceptance = (
  await request(`/api/v1/cases/${created.id}/workflow`, { token: admin })
).body.items.find((item) => item.id === started.id);
check(
  workflowAfterAcceptance.state === "UNDER_REVIEW" &&
    workflowAfterAcceptance.recommendations.length === 0,
  "Assessment acceptance improperly submitted a recommendation.",
);

const invalidRuntime = (
  await request("/api/v1/ai-governance/runtime-configs", {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      code: `INVALID_SCHEMA_${suffix}`,
      mockProfile: "INVALID_SCHEMA",
      enabled: true,
      maxInputBytes: 1048576,
      maxEvidenceItems: 10,
      timeoutMs: 5000,
      retryLimit: 0,
    },
  })
).body;
const invalidPolicy = (
  await request("/api/v1/ai-governance/model-policies", {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      code: `INVALID_SCHEMA_${suffix}`,
      runtimeConfigId: invalidRuntime.id,
      promptTemplateVersionId: "50000000-0000-4000-8000-000000000003",
      allowedClassifications: ["APPLICATION_FORM"],
      allowedMediaTypes: ["text/plain"],
      purpose: "Validator invalid schema profile",
      enabled: true,
    },
  })
).body;
check(Boolean(invalidPolicy.id), "Governance policy was not created.");
const invalidQueued = (
  await request(`/api/v1/cases/${created.id}/ai-assessments`, {
    method: "POST",
    expected: [202],
    token: admin,
    headers: { "idempotency-key": `phase5-invalid-${suffix}` },
    json: {
      modelPolicyId: invalidPolicy.id,
      purpose: "Validate strict output failure",
      expectedWorkflowVersion: workflowAfterAcceptance.rowVersion,
    },
  })
).body;
const invalidOutput = await waitFor(
  "invalid schema rejection",
  () => assessment(invalidQueued.id, admin),
  (item) => item.status === "INVALID_OUTPUT",
);
check(
  invalidOutput.statusReasonCode,
  "Invalid output did not persist a failure reason.",
);
check(
  invalidOutput.output === null,
  "Invalid provider output was exposed as normalized output.",
);
const operations = (
  await request("/api/v1/ai-governance/operations", { token: admin })
).body;
check(
  Array.isArray(operations.queue) && Array.isArray(operations.failures),
  "Governance operations view is unavailable.",
);

const delayedRuntime = (
  await request("/api/v1/ai-governance/runtime-configs", {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      code: `DELAYED_${suffix}`,
      mockProfile: "DELAYED_RESULT",
      enabled: true,
      maxInputBytes: 1048576,
      maxEvidenceItems: 10,
      timeoutMs: 5000,
      retryLimit: 0,
    },
  })
).body;
const delayedPolicy = (
  await request("/api/v1/ai-governance/model-policies", {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      code: `DELAYED_${suffix}`,
      runtimeConfigId: delayedRuntime.id,
      promptTemplateVersionId: "50000000-0000-4000-8000-000000000003",
      allowedClassifications: ["APPLICATION_FORM"],
      allowedMediaTypes: ["text/plain"],
      purpose: "Validator delayed cancellation profile",
      enabled: true,
    },
  })
).body;
const cancellable = (
  await request(`/api/v1/cases/${created.id}/ai-assessments`, {
    method: "POST",
    expected: [202],
    token: admin,
    headers: { "idempotency-key": `phase5-cancel-${suffix}` },
    json: {
      modelPolicyId: delayedPolicy.id,
      purpose: "Validate persisted cancellation",
      expectedWorkflowVersion: workflowAfterAcceptance.rowVersion,
    },
  })
).body;
await request(`/api/v1/ai-assessments/${cancellable.id}/cancel`, {
  method: "POST",
  token: admin,
  json: {},
});
const cancelled = await waitFor(
  "assessment cancellation",
  () => assessment(cancellable.id, admin),
  (item) => item.status === "CANCELLED",
);
check(cancelled.cancelledAt, "Cancellation timestamp was not persisted.");

const caseBeforeChange = (
  await request(`/api/v1/cases/${created.id}`, { token: admin })
).body;
await request(`/api/v1/cases/${created.id}`, {
  method: "PATCH",
  token: admin,
  json: {
    version: caseBeforeChange.version,
    title: `${caseBeforeChange.title} updated`,
  },
});
const superseded = await waitFor(
  "authoritative change supersession",
  () => assessment(queued.id, admin),
  (item) => item.status === "SUPERSEDED",
);
check(
  superseded.statusReasonCode === "AUTHORITATIVE_INPUT_CHANGED",
  "Successful assessment was not superseded by authoritative input change.",
);

const killEnabled = (
  await request("/api/v1/ai-governance/kill-switches", {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      scope: "GLOBAL",
      enabled: true,
      reason: "Phase 5 validator",
    },
  })
).body;
check(killEnabled.enabled === true, "Kill switch was not enabled.");
await request(`/api/v1/cases/${created.id}/ai-assessments`, {
  method: "POST",
  expected: [503],
  token: admin,
  headers: { "idempotency-key": `phase5-killed-${suffix}` },
  json: {
    modelPolicyId: "50000000-0000-4000-8000-000000000004",
    purpose: "Must be blocked by kill switch",
  },
});
assertions += 1;
const killDisabled = (
  await request("/api/v1/ai-governance/kill-switches", {
    method: "POST",
    expected: [201],
    token: admin,
    json: {
      scope: "GLOBAL",
      enabled: false,
      reason: "Phase 5 validator complete",
    },
  })
).body;
check(killDisabled.enabled === false, "Kill switch was not restored.");

check(
  assertions >= 28,
  `Expected at least 28 assertions, observed ${assertions}.`,
);
console.log(
  `PASS Phase 5 MockCortexGateway Docker end-to-end validation (${assertions} assertions)`,
);
