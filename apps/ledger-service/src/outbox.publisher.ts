import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Kafka, type Producer } from "kafkajs";
import { randomUUID } from "node:crypto";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

export function ledgerTopicFor(eventType: string) {
  if (eventType.startsWith("proof.verification"))
    return "cdep.ledger.verification.v1";
  if (
    [
      "proof.submitted",
      "proof.confirmed",
      "proof.failed",
      "decision-proof.confirmed",
    ].includes(eventType)
  )
    return "cdep.ledger.dlt.v1";
  return "cdep.ledger.proof.v1";
}

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly producer: Producer = new Kafka({
    clientId: `${this.environment.KAFKA_CLIENT_ID}-outbox`,
    brokers: this.environment.KAFKA_BROKERS,
  }).producer();
  private timer?: NodeJS.Timeout;
  private connected = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.environment.OUTBOX_ENABLED) return;
    await this.producer.connect();
    this.connected = true;
    this.timer = setInterval(() => void this.publish(), 500);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.connected) await this.producer.disconnect();
  }

  async publish() {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        publishedAt: null,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { occurredAt: "asc" },
      take: 50,
    });
    for (const event of events) {
      try {
        const topic = ledgerTopicFor(event.eventType);
        await this.producer.send({
          topic,
          messages: [
            {
              key: event.aggregateId,
              value: JSON.stringify({
                eventId: event.id,
                eventType: event.eventType,
                eventVersion: event.eventVersion,
                producer: "ledger-service",
                occurredAt: event.occurredAt.toISOString(),
                organizationId: event.organizationId,
                aggregate: {
                  type: event.aggregateType,
                  id: event.aggregateId,
                  version: event.aggregateVersion,
                },
                correlationId: event.correlationId,
                causationId: event.causationId ?? randomUUID(),
                payload: event.payload,
              }),
            },
          ],
        });
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 } },
        });
      } catch {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(
              Date.now() + Math.min(30_000, 500 * 2 ** event.attempts),
            ),
          },
        });
      }
    }
  }
}
