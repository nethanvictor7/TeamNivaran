import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Kafka, type Producer } from "kafkajs";
import { env } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private producer?: Producer;
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: PrismaService) {}
  async onModuleInit() {
    const environment = env();
    const sasl =
      environment.KAFKA_SECURITY_PROTOCOL === "SASL_SSL" &&
      environment.KAFKA_SASL_USERNAME &&
      environment.KAFKA_SASL_PASSWORD
        ? environment.KAFKA_SASL_MECHANISM === "SCRAM-SHA-256"
          ? {
              mechanism: "scram-sha-256" as const,
              username: environment.KAFKA_SASL_USERNAME,
              password: environment.KAFKA_SASL_PASSWORD,
            }
          : {
              mechanism: "scram-sha-512" as const,
              username: environment.KAFKA_SASL_USERNAME,
              password: environment.KAFKA_SASL_PASSWORD,
            }
        : undefined;
    const kafka = new Kafka({
      clientId: "cdep-integration-ingestion-service",
      brokers: environment.KAFKA_BROKERS,
      ssl: environment.KAFKA_SECURITY_PROTOCOL !== "PLAINTEXT",
      ...(sasl ? { sasl } : {}),
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
    await this.producer.connect();
    this.timer = setInterval(() => void this.flush(), 500);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect();
  }
  async flush() {
    if (!this.producer) return;
    const rows = await this.db.outboxEvent.findMany({
      where: {
        publishedAt: null,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { occurredAt: "asc" },
      take: 50,
    });
    for (const row of rows) {
      try {
        await this.producer.send({
          topic: row.topic,
          messages: [
            {
              key: row.messageKey,
              value: JSON.stringify(row.eventJson),
              headers: { "x-correlation-id": row.correlationId },
            },
          ],
        });
        await this.db.$transaction(async (tx) => {
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { publishedAt: new Date(), attempts: { increment: 1 } },
          });
          const canonical = await tx.canonicalTriggerEvent.findUnique({
            where: { id: row.id },
          });
          if (canonical) {
            await tx.canonicalTriggerEvent.update({
              where: { id: row.id },
              data: { status: "PUBLISHED", publishedAt: new Date() },
            });
            await tx.sourceTrigger.update({
              where: { id: canonical.sourceTriggerId },
              data: { status: "PUBLISHED" },
            });
          }
        });
      } catch {
        const delay = Math.min(60_000, 1000 * 2 ** row.attempts);
        this.logger.error(
          { eventId: row.id, attempts: row.attempts + 1 },
          "Integration outbox publish failed",
        );
        await this.db.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + delay),
          },
        });
      }
    }
  }
}
