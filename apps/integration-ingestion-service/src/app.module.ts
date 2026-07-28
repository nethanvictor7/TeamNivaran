import { Module } from "@nestjs/common";
import { AuthGuard } from "./auth.js";
import { ConnectorScheduler } from "./connector-scheduler.js";
import { HealthController } from "./health.controller.js";
import { IntegrationController } from "./integration.controller.js";
import { MetricsController } from "./metrics.controller.js";
import { WebhookController } from "./webhook.controller.js";
import { IntegrationService } from "./integration.service.js";
import { OutboxPublisher } from "./outbox.publisher.js";
import { PostgresSqlPollingAdapter } from "./sql-polling.adapter.js";
import { PrismaService } from "./prisma.service.js";
import { SecretProtector } from "./secret-protector.js";

@Module({
  controllers: [
    WebhookController,
    IntegrationController,
    HealthController,
    MetricsController,
  ],
  providers: [
    PrismaService,
    SecretProtector,
    PostgresSqlPollingAdapter,
    IntegrationService,
    ConnectorScheduler,
    OutboxPublisher,
    AuthGuard,
  ],
})
export class AppModule {}
