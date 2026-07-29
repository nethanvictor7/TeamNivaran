import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { eventEnvelopeSchema } from "@cdep/contracts";
import { createHash } from "node:crypto";
import { Kafka, type Consumer } from "kafkajs";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

const relevantEvents = new Set([
  "evidence.available",
  "evidence.version.available",
  "decision.approved",
  "decision.rejected",
  "decision.final.recorded",
]);

@Injectable()
export class LedgerEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly logger = new Logger(LedgerEventConsumer.name);
  private consumer?: Consumer;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.environment.OUTBOX_ENABLED) return;
    this.consumer = new Kafka({
      clientId: `${this.environment.KAFKA_CLIENT_ID}-inbox`,
      brokers: this.environment.KAFKA_BROKERS,
    }).consumer({ groupId: "cdep-ledger-proof-policy-v1" });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: ["cdep.evidence.events.v1", "cdep.workflow.events.v1"],
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString("utf8") ?? "";
        let value: unknown = {};
        try {
          value = raw ? JSON.parse(raw) : {};
        } catch {
          this.logger.warn({ event: "ledger.inbox.invalid_json" });
          return;
        }
        const parsed = eventEnvelopeSchema.safeParse(value);
        if (!parsed.success) {
          this.logger.warn({ event: "ledger.inbox.invalid_event" });
          return;
        }
        const event = parsed.data;
        if (!relevantEvents.has(event.eventType)) return;
        const payloadSha256 = createHash("sha256").update(raw).digest("hex");
        await this.prisma.inboxEvent.upsert({
          where: { eventId: event.eventId },
          create: {
            eventId: event.eventId,
            eventType: event.eventType,
            payloadSha256,
          },
          update: {},
        });
        // Anchoring remains an explicit authorized API action until an
        // organization-owned auto-anchor policy is introduced.
      },
    });
  }

  async onModuleDestroy() {
    await this.consumer?.disconnect();
  }
}
