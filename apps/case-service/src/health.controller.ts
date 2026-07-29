import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { OutboxService } from "./outbox.service.js";
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}
  @Get("live") live() {
    return { status: "ok", service: "case-service" };
  }
  @Get("startup") startup() {
    return { status: "ok", service: "case-service" };
  }
  @Get("ready") async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      dependencies: {
        postgres: "up",
        kafka: this.outbox.isReady() ? "up" : "down",
      },
    };
  }
}
