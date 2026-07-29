import { Module } from "@nestjs/common";
import { AuthenticationGuard } from "./authentication.js";
import { CaseAccessService } from "./case-access.service.js";
import { EvidenceController } from "./evidence.controller.js";
import { EvidenceService } from "./evidence.service.js";
import { HealthController } from "./health.controller.js";
import { ClamAvScanner } from "./malware-scanner.js";
import { MetricsController } from "./metrics.controller.js";
import { S3EvidenceObjectStorage } from "./object-storage.js";
import { EvidenceOutboxPublisher } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";
import { EvidenceProcessingWorker } from "./processing.worker.js";
import { SourceTriggerConsumer } from "./source-trigger.consumer.js";
import {
  EvidenceInternalController,
  EvidenceInternalGuard,
} from "./internal.controller.js";

@Module({
  controllers: [
    EvidenceController,
    EvidenceInternalController,
    HealthController,
    MetricsController,
  ],
  providers: [
    PrismaService,
    AuthenticationGuard,
    CaseAccessService,
    S3EvidenceObjectStorage,
    ClamAvScanner,
    EvidenceService,
    EvidenceProcessingWorker,
    EvidenceOutboxPublisher,
    SourceTriggerConsumer,
    EvidenceInternalGuard,
  ],
})
export class AppModule {}
