import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Kafka } from "kafkajs";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class AiOutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly kafka = new Kafka({
    clientId: this.environment.KAFKA_CLIENT_ID,
    brokers: this.environment.KAFKA_BROKERS,
  });
  private readonly producer = this.kafka.producer();
  private timer?: NodeJS.Timeout;
  private connected = false;
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    if (!this.environment.OUTBOX_ENABLED) return;
    try {
      await this.producer.connect();
      this.connected = true;
      this.timer = setInterval(() => void this.publish(), 500);
      this.timer.unref();
    } catch {
      this.connected = false;
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.connected) await this.producer.disconnect();
  }
  private async publish() {
    if (!this.connected) return;
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
        await this.producer.send({
          topic: event.eventType.startsWith("ai.governance.")
            ? "cdep.ai.governance.v1"
            : "cdep.ai.assessment.v1",
          messages: [
            {
              key: event.aggregateId,
              value: JSON.stringify({
                eventId: event.id,
                eventType: event.eventType,
                eventVersion: event.eventVersion,
                occurredAt: event.occurredAt,
                organizationId: event.organizationId,
                correlationId: event.correlationId,
                aggregate: {
                  type: event.aggregateType,
                  id: event.aggregateId,
                  version: event.aggregateVersion,
                },
                data: event.payload,
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
            nextAttemptAt: new Date(Date.now() + 2_000),
          },
        });
      }
    }
  }
}
