import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get("live")
  live() {
    return { status: "ok", service: "ai-assessment-service" };
  }
  @Get("startup")
  startup() {
    return {
      status: "ok",
      service: "ai-assessment-service",
      adapterMode: getEnvironment().AI_ADAPTER_MODE,
    };
  }
  @Get("ready")
  async ready(@Res() reply: FastifyReply) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return reply.send({
        status: "ok",
        dependencies: { database: "up" },
        adapterMode: getEnvironment().AI_ADAPTER_MODE,
        liveCortex: "deferred",
      });
    } catch {
      return reply.code(503).send({
        status: "unavailable",
        dependencies: { database: "down" },
      });
    }
  }
}
