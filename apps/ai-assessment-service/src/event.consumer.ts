import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Prisma } from "@cdep/ai-prisma-client";
import { createHash } from "node:crypto";
import { Kafka, type Consumer } from "kafkajs";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class AiInputEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly logger = new Logger(AiInputEventConsumer.name);
  private readonly consumer: Consumer = new Kafka({
    clientId: `${this.environment.KAFKA_CLIENT_ID}-input`,
    brokers: this.environment.KAFKA_BROKERS,
  }).consumer({ groupId: this.environment.AI_CONSUMER_GROUP });
  private connected = false;
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    try {
      await this.consumer.connect();
      this.connected = true;
      await this.consumer.subscribe({
        topics: [
          "cdep.case.v1",
          "cdep.evidence.events.v1",
          "cdep.workflow.events.v1",
        ],
        fromBeginning: false,
      });
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) return;
          const raw = message.value.toString();
          let value: unknown;
          try {
            value = JSON.parse(raw);
          } catch {
            this.logger.warn({ event: "ai.input.invalid_json" });
            return;
          }
          if (!value || typeof value !== "object") return;
          const event = value as {
            eventId?: string;
            eventType?: string;
            occurredAt?: string;
            organizationId?: string;
            aggregate?: { id?: string };
            payload?: { caseId?: string };
            data?: { caseId?: string };
          };
          const caseId =
            event.payload?.caseId ??
            event.data?.caseId ??
            (event.eventType?.startsWith("case.")
              ? event.aggregate?.id
              : undefined);
          if (!event.eventId || !event.organizationId || !caseId) return;
          const organizationId = event.organizationId;
          const occurredAt =
            typeof event.occurredAt === "string"
              ? new Date(event.occurredAt)
              : new Date();
          const exists = await this.prisma.inboxEvent.findUnique({
            where: { eventId: event.eventId },
          });
          if (exists) return;
          await this.prisma.$transaction(async (tx) => {
            await tx.inboxEvent.create({
              data: {
                eventId: event.eventId!,
                eventType: event.eventType ?? "unknown",
                payloadHash: createHash("sha256").update(raw).digest("hex"),
              },
            });
            await tx.assessment.updateMany({
              where: {
                organizationId,
                caseId,
                status: "SUCCEEDED",
                completedAt: { lt: occurredAt },
              },
              data: {
                status: "SUPERSEDED",
                statusReasonCode: "AUTHORITATIVE_INPUT_CHANGED",
                supersededAt: new Date(),
                rowVersion: { increment: 1 },
              },
            });
          });
        },
      });
    } catch {
      this.connected = false;
    }
  }
  async onModuleDestroy() {
    if (this.connected) await this.consumer.disconnect();
  }
}
