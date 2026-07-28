import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { LEDGER_PROVIDER, type ProviderRegistry } from "./provider-registry.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LEDGER_PROVIDER) private readonly providers: ProviderRegistry,
  ) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("startup")
  startup() {
    return { status: "ok", providerType: this.providers.active.providerType };
  }

  @Get("ready")
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    const provider = await this.providers.active.getHealth();
    return {
      status: provider.state === "AVAILABLE" ? "ok" : "degraded",
      database: "up",
      provider,
    };
  }
}
