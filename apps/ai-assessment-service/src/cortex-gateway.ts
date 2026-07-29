import { createHash } from "node:crypto";
import type { AssessmentOutputContract } from "./output-schema.js";

export const CORTEX_GATEWAY = Symbol("CORTEX_GATEWAY");
export type MockProfile =
  | "SUCCESS"
  | "MISSING_INFORMATION"
  | "RISK_INDICATORS"
  | "INVALID_JSON"
  | "INVALID_SCHEMA"
  | "BAD_CITATION"
  | "POLICY_BLOCK"
  | "TIMEOUT"
  | "TRANSIENT_FAILURE"
  | "DELAYED_RESULT";

export type CortexAssessmentInput = {
  assessmentId: string;
  inputFingerprint: string;
  profile: MockProfile;
  evidenceRefs: Array<{
    evidenceAssetId: string;
    evidenceVersionId: string;
  }>;
};
export type CortexSubmission = {
  providerExecutionId: string;
  submittedAt: string;
};
export type CortexResult = {
  providerExecutionId: string;
  completedAt: string;
  rawOutput: unknown;
};

export interface CortexGateway {
  submit(
    input: CortexAssessmentInput,
    signal?: AbortSignal,
  ): Promise<CortexSubmission>;
  result(
    submission: CortexSubmission,
    input: CortexAssessmentInput,
    signal?: AbortSignal,
  ): Promise<CortexResult>;
  cancel(providerExecutionId: string): Promise<void>;
  testConnection(
    context: { correlationId: string },
    signal?: AbortSignal,
  ): Promise<{
    adapterMode: "MOCK";
    executionMode: "MOCK_SYNCHRONOUS";
    providerLabel: "CDEP_DETERMINISTIC_MOCK_V1";
    isSynthetic: true;
    correlationId: string;
  }>;
}

export class CortexGatewayError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

const sleep = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CortexGatewayError("MOCK_ABORTED", false));
      },
      { once: true },
    );
  });

export class MockCortexGateway implements CortexGateway {
  async submit(input: CortexAssessmentInput, signal?: AbortSignal) {
    if (signal?.aborted) throw new CortexGatewayError("MOCK_ABORTED", false);
    if (input.profile === "POLICY_BLOCK")
      throw new CortexGatewayError("MOCK_POLICY_BLOCK", false);
    if (input.profile === "TIMEOUT") {
      await sleep(60_000, signal);
      throw new CortexGatewayError("MOCK_TIMEOUT", true);
    }
    if (input.profile === "TRANSIENT_FAILURE")
      throw new CortexGatewayError("MOCK_TRANSIENT_FAILURE", true);
    if (input.profile === "DELAYED_RESULT") await sleep(750, signal);
    return {
      providerExecutionId: `mock-${createHash("sha256")
        .update(`${input.assessmentId}:${input.inputFingerprint}`)
        .digest("hex")
        .slice(0, 24)}`,
      submittedAt: new Date().toISOString(),
    };
  }

  async result(
    submission: CortexSubmission,
    input: CortexAssessmentInput,
    signal?: AbortSignal,
  ) {
    if (input.profile === "DELAYED_RESULT") await sleep(750, signal);
    const ref = input.evidenceRefs[0];
    const base: AssessmentOutputContract = {
      schemaVersion: "1.0",
      summary:
<<<<<<< HEAD
        "This simulated assessment reviewed the current case, workflow and selected evidence. The case still requires a human review.",
=======
        "A deterministic mock assessment was completed against the pinned case, workflow, and evidence snapshot. Human review remains mandatory.",
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
      recommendation: "REVIEW_REQUIRED",
      confidence: 72,
      findings: [
        {
          code: "HUMAN_REVIEW_REQUIRED",
<<<<<<< HEAD
          title: "Human review required",
          detail:
            "This result can help organise the review, but it cannot approve or reject the case.",
=======
          title: "Controlled review required",
          detail:
            "The synthetic assessment is decision support only and does not make or approve a credit decision.",
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          severity: "MEDIUM",
        },
      ],
      missingInformation: [],
      riskIndicators: [],
      citations: ref
        ? [
            {
              code: "PINNED_EVIDENCE",
              evidenceAssetId: ref.evidenceAssetId,
              evidenceVersionId: ref.evidenceVersionId,
            },
          ]
        : [],
    };
    let rawOutput: unknown = base;
    if (input.profile === "MISSING_INFORMATION")
      rawOutput = {
        ...base,
        recommendation: "MORE_INFORMATION_REQUIRED",
        missingInformation: [
          {
            code: "UPDATED_FINANCIALS",
            label: "Current financial information",
            required: true,
          },
        ],
      };
    if (input.profile === "RISK_INDICATORS")
      rawOutput = {
        ...base,
        riskIndicators: [
          {
            code: "INCONSISTENT_DECLARATION",
            label: "A declared value requires human verification",
            severity: "HIGH",
          },
        ],
      };
    if (input.profile === "INVALID_JSON") rawOutput = "{not-json";
    if (input.profile === "INVALID_SCHEMA")
      rawOutput = { schemaVersion: "1.0", decision: "APPROVE" };
    if (input.profile === "BAD_CITATION")
      rawOutput = {
        ...base,
        citations: [
          {
            code: "UNPINNED_EVIDENCE",
            evidenceAssetId: "00000000-0000-4000-8000-000000000099",
            evidenceVersionId: "00000000-0000-4000-8000-000000000098",
          },
        ],
      };
    return {
      providerExecutionId: submission.providerExecutionId,
      completedAt: new Date().toISOString(),
      rawOutput,
    };
  }

  async cancel(_providerExecutionId: string) {
    return;
  }

  async testConnection(
    context: { correlationId: string },
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw new CortexGatewayError("MOCK_ABORTED", false);
    return {
      adapterMode: "MOCK" as const,
      executionMode: "MOCK_SYNCHRONOUS" as const,
      providerLabel: "CDEP_DETERMINISTIC_MOCK_V1" as const,
      isSynthetic: true as const,
      correlationId: context.correlationId,
    };
  }
}
