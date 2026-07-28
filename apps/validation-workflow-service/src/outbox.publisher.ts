import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { eventEnvelopeSchema } from "@cdep/contracts";
import { Kafka, type Producer } from "kafkajs";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

export function kafkaOptions(environment: ReturnType<typeof getEnvironment>) {
  const sasl =
    environment.KAFKA_SECURITY_PROTOCOL === "SASL_SSL" &&
    environment.KAFKA_SASL_USERNAME &&
    environment.KAFKA_SASL_PASSWORD
      ? environment.KAFKA_SASL_MECHANISM === "PLAIN"
        ? {
            mechanism: "plain" as const,
            username: environment.KAFKA_SASL_USERNAME,
            password: environment.KAFKA_SASL_PASSWORD,
          }
        : environment.KAFKA_SASL_MECHANISM === "SCRAM-SHA-256"
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
  return {
    clientId: environment.KAFKA_CLIENT_ID,
    brokers: environment.KAFKA_BROKERS,
    ssl: environment.KAFKA_SECURITY_PROTOCOL !== "PLAINTEXT",
    ...(sasl ? { sasl } : {}),
  };
}

@Injectable()
export class WorkflowOutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowOutboxPublisher.name);
  private readonly environment = getEnvironment();
  private producer?: Producer;
  private timer?: NodeJS.Timeout;
  private readyState = false;
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.environment.OUTBOX_ENABLED) return;
    this.producer = new Kafka(kafkaOptions(this.environment)).producer();
    await this.producer.connect();
    this.readyState = true;
    this.timer = setInterval(() => void this.flush(), 500);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect();
  }
  ready() {
    return !this.environment.OUTBOX_ENABLED || this.readyState;
  }
  async flush() {
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
        const event = eventEnvelopeSchema.parse({
          eventId: row.id,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          occurredAt: row.occurredAt.toISOString(),
          correlationId: row.correlationId,
          causationId: row.causationId,
          producer: "validation-workflow-service",
          organizationId: row.organizationId,
          actor: { type: row.actorType, id: row.actorId },
          aggregate: {
            type: row.aggregateType,
            id: row.aggregateId,
            version: row.aggregateVersion,
          },
          payload: row.payload,
        });
        await this.producer.send({
          topic: "cdep.workflow.events.v1",
          messages: [{ key: row.aggregateId, value: JSON.stringify(event) }],
        });
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 } },
        });
      } catch (error) {
        this.logger.error({
          event: "workflow.outbox.publish.failed",
          eventId: row.id,
          code: error instanceof Error ? error.name : "unknown",
        });
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
