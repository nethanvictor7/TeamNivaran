import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRules,
  workflowConfigurationSchema,
} from "../dist/src/rules.js";

const configuration = {
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
      id: "application-form-required",
      type: "REQUIRED_EVIDENCE_PRESENT",
      classificationCode: "APPLICATION_FORM",
    },
    {
      id: "amount-positive",
      type: "CASE_NUMERIC_MIN",
      field: "requestedAmountMinor",
      value: 1,
    },
  ],
  reasonCodes: ["STANDARD_REVIEW"],
  reviewOutcomes: ["READY_FOR_RECOMMENDATION", "CORRECTION_REQUIRED"],
};

const evidence = [
  {
    evidenceAssetId: "0b4358cf-4f6c-4557-857b-b51d17b9130c",
    evidenceVersionId: "5ac6c7b5-9ad6-47ae-a01d-4b673a37ad62",
    sha256: "a".repeat(64),
    classificationCode: "APPLICATION_FORM",
    evidenceStatus: "ACTIVE",
    processingStatus: "AVAILABLE",
    malwareStatus: "CLEAN",
    authoritative: true,
    availableAt: "2026-07-27T00:00:00.000Z",
    createdById: "fc111e83-1394-4ab5-bcf3-04e07cf7b93f",
    mimeType: "application/pdf",
    sizeBytes: "100",
  },
];

test("strict Workflow configuration rejects executable or unknown fields", () => {
  assert.equal(
    workflowConfigurationSchema.safeParse(configuration).success,
    true,
  );
  assert.equal(
    workflowConfigurationSchema.safeParse({
      ...configuration,
      executableExpression: "eval(input)",
    }).success,
    false,
  );
  assert.equal(
    workflowConfigurationSchema.safeParse({
      ...configuration,
      rules: [{ id: "unsafe", type: "CUSTOM_SCRIPT", script: "return true" }],
    }).success,
    false,
  );
});

test("rule evaluation is deterministic for an immutable snapshot", () => {
  const parsed = workflowConfigurationSchema.parse(configuration);
  const input = { requestedAmountMinor: 2500000 };
  const first = evaluateRules(parsed, input, evidence);
  const second = evaluateRules(parsed, input, evidence);
  assert.deepEqual(first, second);
  assert(first.every((result) => result.status === "PASS"));
});

test("unavailable Evidence fails required completeness", () => {
  const parsed = workflowConfigurationSchema.parse(configuration);
  const result = evaluateRules(parsed, { requestedAmountMinor: 2500000 }, [
    { ...evidence[0], processingStatus: "REJECTED" },
  ]);
  assert.equal(result[0].status, "FAIL");
});
