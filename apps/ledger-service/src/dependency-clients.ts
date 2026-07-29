import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { getEnvironment } from "./environment.js";

async function internalPost<T>(
  url: string,
  correlationId: string,
  body: object,
): Promise<T> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cdep-internal-service-token":
          getEnvironment().INTERNAL_SERVICE_TOKEN,
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404)
      throw new NotFoundException("Dependency resource not found.");
    if (!response.ok)
      throw new ServiceUnavailableException(
        "A required proof dependency is unavailable.",
      );
    return (await response.json()) as T;
  } catch (error) {
    if (
      error instanceof NotFoundException ||
      error instanceof ServiceUnavailableException
    )
      throw error;
    throw new ServiceUnavailableException(
      "A required proof dependency is unavailable.",
    );
  }
}

export type EvidenceProofSnapshot = {
  organizationId: string;
  caseId: string;
  evidenceAssetId: string;
  evidenceVersionId: string;
  versionNumber: number;
  previousVersionId: string | null;
  sha256: string;
  classificationCode: string;
  processingStatus: "AVAILABLE";
  malwareStatus: "CLEAN";
  authoritative: true;
  availableAt: string;
  mediaType: string | null;
  sizeBytes: string | null;
};

export type DecisionProofSnapshot = {
  organizationId: string;
  caseId: string;
  workflowInstanceId: string;
  decision: {
    id: string;
    outcome: "APPROVED" | "REJECTED";
    reasonCodes: string[];
    decidedAt: string;
    validationRunId: string;
    cycleNumber: number;
    definitionVersionSnapshot: unknown;
  };
  recommendation: {
    id: string;
    outcome: string;
    reasonCodes: string[];
    conditions: unknown;
    supportingAssessmentIds: string[];
    submittedAt: string;
  };
  evidenceManifest: Array<{
    evidenceAssetId: string;
    evidenceVersionId: string;
    sha256: string;
    classificationCode: string;
    availableAt: string;
  }>;
};

export type CaseEvidenceSnapshot = {
  organizationId: string;
  caseId: string;
  snapshotAt: string;
  items: Array<{
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
  }>;
};

@Injectable()
export class DependencyClients {
  private readonly environment = getEnvironment();

  evidenceSnapshot(
    organizationId: string,
    evidenceAssetId: string,
    evidenceVersionId: string,
    correlationId: string,
  ) {
    return internalPost<EvidenceProofSnapshot>(
      `${this.environment.EVIDENCE_SERVICE_URL}/internal/v1/evidence/proof-snapshot`,
      correlationId,
      { organizationId, evidenceAssetId, evidenceVersionId },
    );
  }

  caseSnapshot(organizationId: string, caseId: string, correlationId: string) {
    return internalPost<{ id: string; status: string }>(
      `${this.environment.CASE_SERVICE_URL}/internal/v1/cases/access-check`,
      correlationId,
      { organizationId, caseId },
    );
  }

  caseEvidenceSnapshot(
    organizationId: string,
    caseId: string,
    correlationId: string,
  ) {
    return internalPost<CaseEvidenceSnapshot>(
      `${this.environment.EVIDENCE_SERVICE_URL}/internal/v1/evidence/case-snapshot`,
      correlationId,
      { organizationId, caseId },
    );
  }

  decisionSnapshot(
    organizationId: string,
    caseId: string,
    correlationId: string,
  ) {
    return internalPost<DecisionProofSnapshot>(
      `${this.environment.WORKFLOW_SERVICE_URL}/internal/v1/workflow/decision-proof-snapshot`,
      correlationId,
      { organizationId, caseId },
    );
  }

  async evidenceContentHash(
    snapshot: EvidenceProofSnapshot,
    correlationId: string,
  ) {
    const response = await fetch(
      `${this.environment.EVIDENCE_SERVICE_URL}/internal/v1/evidence/version-content`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cdep-internal-service-token":
            this.environment.INTERNAL_SERVICE_TOKEN,
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify({
          organizationId: snapshot.organizationId,
          caseId: snapshot.caseId,
          evidenceAssetId: snapshot.evidenceAssetId,
          evidenceVersionId: snapshot.evidenceVersionId,
          expectedSha256: snapshot.sha256,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok || !response.body)
      throw new ServiceUnavailableException(
        "Exact Evidence content is unavailable for proof anchoring.",
      );
    const hasher = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 20 * 1024 * 1024)
        throw new ServiceUnavailableException(
          "Evidence content exceeds the proof verification limit.",
        );
      hasher.update(buffer);
    }
    return { sha256: hasher.digest("hex"), bytes };
  }
}
