import { z } from "zod";

const ruleBase = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
});

export const validationRuleSchema = z.discriminatedUnion("type", [
  ruleBase.extend({
    type: z.literal("REQUIRED_EVIDENCE_PRESENT"),
    classificationCode: z.string().min(1).max(80),
  }),
  ruleBase.extend({
    type: z.literal("MINIMUM_EVIDENCE_COUNT"),
    classificationCode: z.string().min(1).max(80),
    minimum: z.number().int().min(1).max(100),
  }),
  ruleBase.extend({
    type: z.literal("EVIDENCE_STATUS_IN_SET"),
    allowed: z.array(z.literal("AVAILABLE")).min(1).max(1),
  }),
  ruleBase.extend({
    type: z.literal("EVIDENCE_NOT_EXPIRED"),
    classificationCode: z.string().min(1).max(80),
    maximumAgeDays: z.number().int().min(1).max(3650),
  }),
  ruleBase.extend({
    type: z.literal("CASE_FIELD_PRESENT"),
    field: z.enum([
      "title",
      "caseType",
      "requestedAmountMinor",
      "currency",
      "priority",
    ]),
  }),
  ruleBase.extend({
    type: z.literal("CASE_FIELD_EQUALS"),
    field: z.enum(["caseType", "currency", "priority", "status"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  ruleBase.extend({
    type: z.literal("CASE_FIELD_IN_SET"),
    field: z.enum(["caseType", "currency", "priority", "status"]),
    values: z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .max(50),
  }),
  ruleBase.extend({
    type: z.literal("CASE_NUMERIC_MIN"),
    field: z.literal("requestedAmountMinor"),
    value: z.number().finite(),
  }),
  ruleBase.extend({
    type: z.literal("CASE_NUMERIC_MAX"),
    field: z.literal("requestedAmountMinor"),
    value: z.number().finite(),
  }),
]);

export const workflowConfigurationSchema = z
  .object({
    caseTypes: z.array(z.string().min(1).max(80)).min(1).max(50),
    requiredEvidence: z
      .array(
        z
          .object({
            classificationCode: z.string().min(1).max(80),
            minimumCount: z.number().int().min(1).max(100),
            currentOnly: z.boolean(),
            maximumAgeDays: z.number().int().min(1).max(3650).optional(),
          })
          .strict(),
      )
      .max(100),
    rules: z.array(validationRuleSchema).min(1).max(200),
    reasonCodes: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/))
      .min(1)
      .max(100),
    reviewOutcomes: z
      .array(z.enum(["READY_FOR_RECOMMENDATION", "CORRECTION_REQUIRED"]))
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const rule of value.rules) {
      if (ids.has(rule.id))
        context.addIssue({
          code: "custom",
          message: `Duplicate validation rule ${rule.id}.`,
        });
      ids.add(rule.id);
    }
  });

export type WorkflowConfiguration = z.infer<typeof workflowConfigurationSchema>;
export type EvidenceSnapshotItem = {
  evidenceAssetId: string;
  evidenceVersionId: string;
  sha256: string;
  classificationCode: string;
  evidenceStatus: string;
  processingStatus: string;
  malwareStatus: string;
  authoritative: boolean;
  availableAt: string;
  createdById: string;
  mimeType: string | null;
  sizeBytes: string | null;
};

export type EvaluatedRule = {
  ruleDefinitionId: string;
  ruleType: string;
  status: "PASS" | "FAIL" | "WARNING" | "NOT_APPLICABLE" | "ERROR";
  messageCode: string;
  safeParameters: Record<string, unknown>;
  inputReferences: Record<string, unknown>;
};

export function evaluateRules(
  configuration: WorkflowConfiguration,
  caseSnapshot: Record<string, unknown>,
  evidence: EvidenceSnapshotItem[],
  now = new Date(),
): EvaluatedRule[] {
  return configuration.rules.map((rule): EvaluatedRule => {
    let pass = false;
    let references: Record<string, unknown> = {};
    if (rule.type === "REQUIRED_EVIDENCE_PRESENT") {
      const matches = evidence.filter(
        (item) =>
          item.classificationCode === rule.classificationCode &&
          item.processingStatus === "AVAILABLE" &&
          item.malwareStatus === "CLEAN" &&
          item.authoritative,
      );
      pass = matches.length > 0;
      references = {
        evidenceVersionIds: matches.map((item) => item.evidenceVersionId),
      };
    } else if (rule.type === "MINIMUM_EVIDENCE_COUNT") {
      const matches = evidence.filter(
        (item) =>
          item.classificationCode === rule.classificationCode &&
          item.processingStatus === "AVAILABLE" &&
          item.authoritative,
      );
      pass = matches.length >= rule.minimum;
      references = {
        evidenceVersionIds: matches.map((item) => item.evidenceVersionId),
      };
    } else if (rule.type === "EVIDENCE_STATUS_IN_SET") {
      pass = evidence.every((item) => item.processingStatus === "AVAILABLE");
    } else if (rule.type === "EVIDENCE_NOT_EXPIRED") {
      const matches = evidence.filter(
        (item) => item.classificationCode === rule.classificationCode,
      );
      pass =
        matches.length > 0 &&
        matches.every(
          (item) =>
            now.getTime() - new Date(item.availableAt).getTime() <=
            rule.maximumAgeDays * 86_400_000,
        );
    } else if (rule.type === "CASE_FIELD_PRESENT") {
      const value = caseSnapshot[rule.field];
      pass =
        value !== undefined &&
        value !== null &&
        (typeof value !== "string" || value.trim().length > 0);
      references = { caseField: rule.field };
    } else if (rule.type === "CASE_FIELD_EQUALS") {
      pass = caseSnapshot[rule.field] === rule.value;
      references = { caseField: rule.field };
    } else if (rule.type === "CASE_FIELD_IN_SET") {
      pass = rule.values.includes(caseSnapshot[rule.field] as never);
      references = { caseField: rule.field };
    } else if (rule.type === "CASE_NUMERIC_MIN") {
      const value = Number(caseSnapshot[rule.field]);
      pass = Number.isFinite(value) && value >= rule.value;
      references = { caseField: rule.field };
    } else if (rule.type === "CASE_NUMERIC_MAX") {
      const value = Number(caseSnapshot[rule.field]);
      pass = Number.isFinite(value) && value <= rule.value;
      references = { caseField: rule.field };
    }
    return {
      ruleDefinitionId: rule.id,
      ruleType: rule.type,
      status: pass ? "PASS" : "FAIL",
      messageCode: pass ? "RULE_PASSED" : "RULE_FAILED",
      safeParameters:
        "classificationCode" in rule
          ? { classificationCode: rule.classificationCode }
          : {},
      inputReferences: references,
    };
  });
}
