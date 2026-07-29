import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { AuditEventConsumer } from "./event.consumer.js";
import { PrismaService } from "./prisma.service.js";
import { ArtifactStorage } from "./storage.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: AuditEventConsumer,
    private readonly storage: ArtifactStorage,
  ) {}

  @Get("live")
  live() {
    return { status: "ok", service: "audit-query-service" };
  }

  @Get("startup")
  startup() {
    return { status: "ok", projectionVersion: 1 };
  }

  @Get("ready")
  async ready() {
    await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.storage.ready()]);
    const kafka = this.consumer.health();
    if (!kafka.connected)
      throw new ServiceUnavailableException({
        status: "unavailable",
        database: "up",
        objectStorage: "up",
        kafka,
      });
    return {
      status: "ok",
      database: "up",
      objectStorage: "up",
      kafka,
    };
  }
}
