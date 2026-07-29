import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller.js";
import { AuditEventConsumer } from "./event.consumer.js";
import { AuditService } from "./audit.service.js";
import { AuthenticationGuard } from "./authentication.js";
import { HealthController } from "./health.controller.js";
import { AuditJobWorker } from "./job.worker.js";
import { PrismaService } from "./prisma.service.js";
import { ArtifactStorage } from "./storage.service.js";

@Module({
  controllers: [AuditController, HealthController],
  providers: [
    PrismaService,
    ArtifactStorage,
    AuthenticationGuard,
    AuditService,
    AuditEventConsumer,
    AuditJobWorker,
  ],
})
export class AppModule {}
