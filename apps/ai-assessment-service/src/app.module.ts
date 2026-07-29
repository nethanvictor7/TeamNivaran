import { Module } from "@nestjs/common";
import { AssessmentController } from "./assessment.controller.js";
import { AssessmentService } from "./assessment.service.js";
import { AssessmentWorker } from "./assessment.worker.js";
import { AuthenticationGuard } from "./authentication.js";
import { CORTEX_GATEWAY, MockCortexGateway } from "./cortex-gateway.js";
import { DependencyClients } from "./dependency-clients.js";
import { AiInputEventConsumer } from "./event.consumer.js";
import { HealthController } from "./health.controller.js";
import { MetricsController } from "./metrics.controller.js";
import { AiOutboxPublisher } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [AssessmentController, HealthController, MetricsController],
  providers: [
    PrismaService,
    AuthenticationGuard,
    DependencyClients,
    AssessmentService,
    AssessmentWorker,
    AiOutboxPublisher,
    AiInputEventConsumer,
    { provide: CORTEX_GATEWAY, useClass: MockCortexGateway },
  ],
})
export class AppModule {}
