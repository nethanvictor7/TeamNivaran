import assert from "node:assert/strict";
import test from "node:test";
import { validateAssessmentOutput } from "../dist/src/output-schema.js";

const ref = {
  evidenceAssetId: "10000000-0000-4000-8000-000000000002",
  evidenceVersionId: "10000000-0000-4000-8000-000000000003",
};
const valid = {
  schemaVersion: "1.0",
  summary: "Synthetic review support only.",
  recommendation: "REVIEW_REQUIRED",
  confidence: 70,
  findings: [
    {
      code: "HUMAN_REVIEW",
      title: "Review required",
      detail: "A human reviewer must assess the pinned records.",
      severity: "MEDIUM",
    },
  ],
  missingInformation: [],
  riskIndicators: [],
  citations: [{ code: "PINNED_REF", ...ref }],
};

test("strict output accepts pinned citations", () => {
  assert.equal(validateAssessmentOutput(valid, [ref]).schemaVersion, "1.0");
});

test("strict output rejects unpinned citations", () => {
  assert.throws(
    () =>
      validateAssessmentOutput(
        {
          ...valid,
          citations: [
            {
              ...valid.citations[0],
              evidenceVersionId: "10000000-0000-4000-8000-000000000099",
            },
          ],
        },
        [ref],
      ),
    /OUTPUT_BAD_CITATION/,
  );
});

test("strict output rejects decisions, HTML, and extra fields", () => {
  assert.throws(() =>
    validateAssessmentOutput(
      { ...valid, decision: "APPROVE", summary: "<b>approve</b>" },
      [ref],
    ),
  );
});
