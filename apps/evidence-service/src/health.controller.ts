import { Controller, Get } from "@nestjs/common";
import { ClamAvScanner } from "./malware-scanner.js";
import { S3EvidenceObjectStorage } from "./object-storage.js";
import { EvidenceOutboxPublisher } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3EvidenceObjectStorage,
    private readonly scanner: ClamAvScanner,
    private readonly outbox: EvidenceOutboxPublisher,
  ) {}
  @Get("live")
  live() {
    return { status: "ok", service: "evidence-service" };
  }
  @Get("startup")
  startup() {
    return { status: "ok", service: "evidence-service" };
  }
  @Get("ready")
  async ready() {
    await Promise.all([
      this.prisma.$queryRaw`SELECT 1`,
      this.storage.ready(),
      this.scanner.ready(),
    ]);
    if (!this.outbox.ready()) throw new Error("Kafka outbox is not ready.");
    return {
      status: "ok",
      dependencies: {
        postgres: "up",
        objectStorage: "up",
        clamav: "up",
        kafka: "up",
      },
    };
  }
}
