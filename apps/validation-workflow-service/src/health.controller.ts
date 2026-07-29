import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { getEnvironment } from "./environment.js";
import { WorkflowOutboxPublisher } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";

@Controller("health")
export class HealthController {
  private readonly environment = getEnvironment();
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: WorkflowOutboxPublisher,
  ) {}
  @Get("live")
  live() {
    return { status: "ok", service: "validation-workflow-service" };
  }
  @Get("startup")
  startup() {
    return { status: "ok", service: "validation-workflow-service" };
  }
  @Get("ready")
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const responses = await Promise.all([
        fetch(`${this.environment.CASE_SERVICE_URL}/health/ready`, {
          signal: AbortSignal.timeout(2000),
        }),
        fetch(`${this.environment.EVIDENCE_SERVICE_URL}/health/ready`, {
          signal: AbortSignal.timeout(2500),
        }),
        fetch(`${this.environment.IDENTITY_SERVICE_URL}/health/ready`, {
          signal: AbortSignal.timeout(2000),
        }),
      ]);
      if (responses.some((response) => !response.ok) || !this.outbox.ready())
        throw new Error("A Workflow dependency is unavailable.");
      return {
        status: "ok",
        dependencies: {
          postgres: "up",
          kafka: "up",
          caseService: "up",
          evidenceService: "up",
          identityService: "up",
        },
      };
    } catch {
      void reply.code(503);
      return { status: "unavailable" };
    }
  }
}
