import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { getEnvironment } from "./environment.js";

@Injectable()
export class CaseAccessService {
  private readonly environment = getEnvironment();

  async assertAccessible(
    caseId: string,
    organizationId: string,
    correlationId: string,
  ): Promise<{ id: string; caseNumber: string; title: string }> {
    try {
      const response = await fetch(
        `${this.environment.CASE_SERVICE_URL}/internal/v1/cases/access-check`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-cdep-internal-service-token":
              this.environment.INTERNAL_SERVICE_TOKEN,
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify({ caseId, organizationId }),
          signal: AbortSignal.timeout(3000),
        },
      );
      if (response.status === 404)
        throw new NotFoundException("Case not found.");
      if (!response.ok) {
        throw new ServiceUnavailableException(
          "Case access could not be verified.",
        );
      }
      return (await response.json()) as {
        id: string;
        caseNumber: string;
        title: string;
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        "Case access could not be verified.",
      );
    }
  }
}
