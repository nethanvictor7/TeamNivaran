import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Kafka, type Producer } from "kafkajs";
import { eventEnvelopeSchema } from "@cdep/contracts";
import { PrismaService } from "./prisma.service.js";
import { getEnvironment } from "./environment.js";

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private readonly env = getEnvironment();
  private producer?: Producer;
  private timer?: NodeJS.Timeout;
  private ready = false;
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    if (!this.env.OUTBOX_ENABLED) return;
    const sasl =
      this.env.KAFKA_SECURITY_PROTOCOL.startsWith("SASL") &&
      this.env.KAFKA_SASL_USERNAME &&
      this.env.KAFKA_SASL_PASSWORD
        ? {
            mechanism: (
              this.env.KAFKA_SASL_MECHANISM ?? "SCRAM-SHA-512"
            ).toLowerCase() as any,
            username: this.env.KAFKA_SASL_USERNAME,
            password: this.env.KAFKA_SASL_PASSWORD,
          }
        : undefined;
    this.producer = new Kafka({
      clientId: "cdep-case-service",
      brokers: this.env.KAFKA_BROKERS,
      ssl: this.env.KAFKA_SECURITY_PROTOCOL !== "PLAINTEXT",
      ...(sasl ? { sasl } : {}),
    }).producer();
    await this.producer.connect();
    this.ready = true;
    this.timer = setInterval(
      () => void this.publish(),
      this.env.OUTBOX_POLL_MS,
    );
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect();
  }
  isReady() {
    return !this.env.OUTBOX_ENABLED || this.ready;
  }
  private async publish() {
    if (!this.producer) return;
    const rows = await this.prisma.outboxEvent.findMany({
      where: {
        publishedAt: null,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { occurredAt: "asc" },
      take: 50,
    });
    for (const row of rows) {
      try {
        const envelope = eventEnvelopeSchema.parse({
          eventId: row.id,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          occurredAt: row.occurredAt.toISOString(),
          correlationId: row.correlationId,
          causationId: row.causationId,
          producer: "case-service",
          organizationId: row.organizationId,
          actor: { type: "USER", id: row.actorId },
          aggregate: {
            type: row.aggregateType,
            id: row.aggregateId,
            version: row.aggregateVersion,
          },
          payload: row.payload,
        });
        await this.producer.send({
          topic: "cdep.case.v1",
          messages: [
            {
              key: row.aggregateId,
              value: JSON.stringify(envelope),
              headers: { "x-correlation-id": row.correlationId },
            },
          ],
        });
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 } },
        });
      } catch (error) {
        this.logger.error(
          {
            eventId: row.id,
            error: error instanceof Error ? error.message : "unknown",
          },
          "Outbox publish failed",
        );
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(
              Date.now() + Math.min(60_000, 1000 * 2 ** row.attempts),
            ),
          },
        });
      }
    }
  }
}
