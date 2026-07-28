import { Module } from "@nestjs/common";
import { AuthenticationGuard } from "./authentication.js";
import {
  CaseClient,
  EvidenceClient,
  IdentityClient,
} from "./dependency-clients.js";
import { WorkflowEventConsumer } from "./event.consumer.js";
import { HealthController } from "./health.controller.js";
import { MetricsController } from "./metrics.controller.js";
import { OperationalWorker } from "./operational.worker.js";
import { WorkflowOutboxPublisher } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";
import { WorkflowController } from "./workflow.controller.js";
import { WorkflowService } from "./workflow.service.js";
import {
  WorkflowInternalController,
  WorkflowInternalGuard,
} from "./internal.controller.js";

@Module({
  controllers: [
    WorkflowController,
    WorkflowInternalController,
    HealthController,
    MetricsController,
  ],
  providers: [
    PrismaService,
    AuthenticationGuard,
    CaseClient,
    EvidenceClient,
    IdentityClient,
    WorkflowService,
    WorkflowOutboxPublisher,
    WorkflowEventConsumer,
    OperationalWorker,
    WorkflowInternalGuard,
  ],
})
export class AppModule {}
