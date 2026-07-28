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
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404)
      throw new NotFoundException("Dependency resource not found.");
    if (!response.ok)
      throw new ServiceUnavailableException(
        "A required dependency contract could not be completed.",
      );
    return (await response.json()) as T;
  } catch (error) {
    if (
      error instanceof NotFoundException ||
      error instanceof ServiceUnavailableException
    )
      throw error;
    throw new ServiceUnavailableException(
      "A required dependency contract could not be completed.",
    );
  }
}

export type CaseSnapshot = {
  id: string;
  caseNumber: string;
  title: string;
  caseType: string;
  status: string;
  priority: string;
  requestedAmountMinor: number | null;
  currency: string | null;
  version: number;
};
export type EvidenceRef = {
  evidenceAssetId: string;
  evidenceVersionId: string;
  sha256: string;
  classificationCode: string;
  evidenceStatus: string;
  processingStatus: string;
  malwareStatus: string;
  authoritative: boolean;
  availableAt: string;
  mimeType: string | null;
  sizeBytes: string | null;
};
export type WorkflowContext = {
  id: string;
  caseId: string;
  state: string;
  cycleNumber: number;
  rowVersion: number;
  workflowDefinitionVersionId: string;
  validation: {
    id: string;
    status: string;
    caseSnapshot: unknown;
    evidenceSnapshot: { items: EvidenceRef[] };
  };
  tasks: unknown[];
};

@Injectable()
export class DependencyClients {
  private readonly env = getEnvironment();
  caseSnapshot(organizationId: string, caseId: string, correlationId: string) {
    return internalPost<CaseSnapshot>(
      `${this.env.CASE_SERVICE_URL}/internal/v1/cases/access-check`,
      correlationId,
      { organizationId, caseId },
    );
  }
  workflowContext(
    organizationId: string,
    caseId: string,
    correlationId: string,
  ) {
    return internalPost<WorkflowContext>(
      `${this.env.WORKFLOW_SERVICE_URL}/internal/v1/workflow/assessment-context`,
      correlationId,
      { organizationId, caseId },
    );
  }
  evidenceSnapshot(
    organizationId: string,
    caseId: string,
    correlationId: string,
  ) {
    return internalPost<{
      organizationId: string;
      caseId: string;
      snapshotAt: string;
      items: EvidenceRef[];
    }>(
      `${this.env.EVIDENCE_SERVICE_URL}/internal/v1/evidence/case-snapshot`,
      correlationId,
      { organizationId, caseId },
    );
  }
  eligibility(
    organizationId: string,
    userId: string,
    permission: string,
    correlationId: string,
  ) {
    return internalPost<{ active: boolean; eligible: boolean }>(
      `${this.env.IDENTITY_SERVICE_URL}/internal/v1/identity/eligibility`,
      correlationId,
      { organizationId, userId, requiredPermission: permission },
    );
  }
  workflowDraft(
    body: object,
    correlationId: string,
  ): Promise<{ draftId: string; workflowVersion: number }> {
    return internalPost(
      `${this.env.WORKFLOW_SERVICE_URL}/internal/v1/workflow/assessment-acceptance`,
      correlationId,
      body,
    );
  }
  async evidenceContent(
    input: {
      organizationId: string;
      caseId: string;
      evidenceAssetId: string;
      evidenceVersionId: string;
      expectedSha256: string;
      maximumBytes: number;
    },
    correlationId: string,
  ) {
    const response = await fetch(
      `${this.env.EVIDENCE_SERVICE_URL}/internal/v1/evidence/version-content`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cdep-internal-service-token": this.env.INTERNAL_SERVICE_TOKEN,
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok || !response.body)
      throw new ServiceUnavailableException(
        "Pinned Evidence content was unavailable.",
      );
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > input.maximumBytes)
        throw new ServiceUnavailableException(
          "Pinned Evidence content exceeded the governed input limit.",
        );
      chunks.push(buffer);
    }
    const content = Buffer.concat(chunks);
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== input.expectedSha256)
      throw new ServiceUnavailableException(
        "Pinned Evidence content failed integrity verification.",
      );
    return {
      content,
      mediaType:
        response.headers.get("content-type") ?? "application/octet-stream",
      sha256: actual,
    };
  }
}
