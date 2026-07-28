import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthenticationGuard } from "./authentication.js";
import { CaseController } from "./case.controller.js";
import { CaseService } from "./case.service.js";
import { HealthController } from "./health.controller.js";
import { OutboxService } from "./outbox.service.js";
import { PrismaService } from "./prisma.service.js";
import { InternalController } from "./internal.controller.js";
import {
  InternalServiceController,
  InternalServiceGuard,
} from "./internal-service.controller.js";
import { EvidenceProjectionConsumer } from "./evidence-projection.consumer.js";
@Module({
  controllers: [
    CaseController,
    InternalController,
    InternalServiceController,
    HealthController,
  ],
  providers: [
    PrismaService,
    CaseService,
    OutboxService,
    AuthenticationGuard,
    InternalServiceGuard,
    EvidenceProjectionConsumer,
  ],
})
export class AppModule {}
