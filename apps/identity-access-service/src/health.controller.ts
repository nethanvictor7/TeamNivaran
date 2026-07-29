import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("live")
  live(): { status: "ok"; service: string } {
    return { status: "ok", service: "identity-access-service" };
  }

  @Get("startup")
  startup(): { status: "ok"; service: string } {
    return { status: "ok", service: "identity-access-service" };
  }

  @Get("ready")
  async ready(): Promise<{ status: "ok"; dependencies: { postgres: "up" } }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", dependencies: { postgres: "up" } };
  }
}
