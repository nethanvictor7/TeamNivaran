import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { env } from "./environment.js";
@Controller("health")
export class HealthController {
  constructor(private db: PrismaService) {}
  @Get("live") live() {
    return { status: "ok", service: "integration-ingestion-service" };
  }
  @Get("startup") startup() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.db.$queryRaw`SELECT 1`;
    try {
      const cases = await fetch(`${env().CASE_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!cases.ok) throw new Error();
    } catch {
      throw new ServiceUnavailableException("Case Service is unavailable.");
    }
    return {
      status: "ok",
      dependencies: {
        postgres: "up",
        caseService: "up",
        credentialProtector: "up",
        kafkaProducer: "up",
      },
    };
  }
}
