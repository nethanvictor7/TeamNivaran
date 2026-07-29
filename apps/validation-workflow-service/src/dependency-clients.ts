import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { getEnvironment } from "./environment.js";
import type { EvidenceSnapshotItem } from "./rules.js";

async function internalPost<T>(
  url: string,
  token: string,
  correlationId: string,
  body: object,
): Promise<T> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cdep-internal-service-token": token,
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4_000),
    });
    if (response.status === 404)
      throw new NotFoundException("Dependency resource not found.");
    if (!response.ok)
      throw new ServiceUnavailableException(
        "A required dependency check could not be completed.",
      );
    return (await response.json()) as T;
  } catch (error) {
    if (
      error instanceof NotFoundException ||
      error instanceof ServiceUnavailableException
    )
      throw error;
    throw new ServiceUnavailableException(
      "A required dependency check could not be completed.",
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
  decisionDueAt: string | null;
  version: number;
};

@Injectable()
export class CaseClient {
  private readonly environment = getEnvironment();
  snapshot(organizationId: string, caseId: string, correlationId: string) {
    return internalPost<CaseSnapshot>(
      `${this.environment.CASE_SERVICE_URL}/internal/v1/cases/access-check`,
      this.environment.INTERNAL_SERVICE_TOKEN,
      correlationId,
      { organizationId, caseId },
    );
  }
  sync(
    input: {
      organizationId: string;
      caseId: string;
      operationId: string;
      workflowInstanceId: string;
      targetStatus: string;
      eventType: string;
      reason: string;
      actorId: string;
    },
    correlationId: string,
  ) {
    return internalPost<{ applied: boolean }>(
      `${this.environment.CASE_SERVICE_URL}/internal/v1/cases/workflow-sync`,
      this.environment.INTERNAL_SERVICE_TOKEN,
      correlationId,
      { ...input, correlationId },
    );
  }
}

@Injectable()
export class EvidenceClient {
  private readonly environment = getEnvironment();
  snapshot(organizationId: string, caseId: string, correlationId: string) {
    return internalPost<{
      organizationId: string;
      caseId: string;
      snapshotAt: string;
      items: EvidenceSnapshotItem[];
    }>(
      `${this.environment.EVIDENCE_SERVICE_URL}/internal/v1/evidence/case-snapshot`,
      this.environment.INTERNAL_SERVICE_TOKEN,
      correlationId,
      { organizationId, caseId },
    );
  }
}

@Injectable()
export class IdentityClient {
  private readonly environment = getEnvironment();
  eligibility(
    organizationId: string,
    userId: string,
    requiredPermission: string,
    correlationId: string,
  ) {
    return internalPost<{
      userId: string;
      organizationId: string;
      active: boolean;
      eligible: boolean;
      permissions: string[];
      roles: string[];
    }>(
      `${this.environment.IDENTITY_SERVICE_URL}/internal/v1/identity/eligibility`,
      this.environment.INTERNAL_SERVICE_TOKEN,
      correlationId,
      { organizationId, userId, requiredPermission },
    );
  }
}
