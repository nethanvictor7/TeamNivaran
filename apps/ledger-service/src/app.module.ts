import { Module } from "@nestjs/common";
import { AuthenticationGuard } from "./authentication.js";
import { CaseProofReadService } from "./case-proof-read.service.js";
import { DependencyClients } from "./dependency-clients.js";
import { LedgerEventConsumer } from "./event.consumer.js";
import { HealthController } from "./health.controller.js";
import { OutboxPublisher } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";
import { ProofController } from "./proof.controller.js";
import { ProofService } from "./proof.service.js";
import { ProofWorker } from "./proof.worker.js";
import { LEDGER_PROVIDER, ProviderRegistry } from "./provider-registry.js";

@Module({
  controllers: [ProofController, HealthController],
  providers: [
    PrismaService,
    AuthenticationGuard,
    DependencyClients,
    ProviderRegistry,
    { provide: LEDGER_PROVIDER, useExisting: ProviderRegistry },
    CaseProofReadService,
    ProofService,
    ProofWorker,
    LedgerEventConsumer,
    OutboxPublisher,
  ],
})
export class AppModule {}
