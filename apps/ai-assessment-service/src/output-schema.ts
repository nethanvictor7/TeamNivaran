import { z } from "zod";

const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/<\/?[a-z][\s\S]*>/i.test(value), "HTML is forbidden.")
    .refine(
      (value) =>
        !/(chain[- ]of[- ]thought|hidden prompt|system prompt|internal reasoning)/i.test(
          value,
        ),
      "Hidden reasoning or prompt disclosure is forbidden.",
    );

export const assessmentOutputSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    summary: safeText(4000),
    recommendation: z.enum([
      "REVIEW_REQUIRED",
      "MORE_INFORMATION_REQUIRED",
      "NO_MATERIAL_ISSUES_IDENTIFIED",
    ]),
    confidence: z.number().int().min(0).max(100),
    findings: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
            title: safeText(200),
            detail: safeText(2000),
            severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
          })
          .strict(),
      )
      .max(25),
    missingInformation: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
            label: safeText(240),
            required: z.boolean(),
          })
          .strict(),
      )
      .max(25),
    riskIndicators: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
            label: safeText(240),
            severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
          })
          .strict(),
      )
      .max(25),
    citations: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
            evidenceAssetId: z.uuid(),
            evidenceVersionId: z.uuid(),
            excerpt: safeText(1000).optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type AssessmentOutputContract = z.infer<typeof assessmentOutputSchema>;

export function validateAssessmentOutput(
  input: unknown,
  refs: Array<{ evidenceAssetId: string; evidenceVersionId: string }>,
) {
  const parsed = assessmentOutputSchema.parse(input);
  for (const collection of [
    parsed.findings,
    parsed.missingInformation,
    parsed.riskIndicators,
    parsed.citations,
  ]) {
    const codes = collection.map((item) => item.code);
    if (new Set(codes).size !== codes.length)
      throw new Error("OUTPUT_DUPLICATE_CODE");
  }
  const allowed = new Set(
    refs.map((ref) => `${ref.evidenceAssetId}:${ref.evidenceVersionId}`),
  );
  for (const citation of parsed.citations)
    if (
      !allowed.has(`${citation.evidenceAssetId}:${citation.evidenceVersionId}`)
    )
      throw new Error("OUTPUT_BAD_CITATION");
  return parsed;
}
