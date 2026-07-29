import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Prisma } from "@cdep/audit-prisma-client";
import type { EventEnvelope } from "@cdep/contracts";
import { Kafka, type Consumer, type SASLOptions } from "kafkajs";
import { randomUUID } from "node:crypto";
import {
  auditRecordHash,
  sanitizeAuditMetadata,
  sha256,
} from "./audit-crypto.js";
import { getEnvironment } from "./environment.js";
import { normalizeDomainEvent } from "./normalize-event.js";
import { PrismaService } from "./prisma.service.js";

function inferOutcome(eventType: string) {
  if (/(denied|forbidden|rejected)/i.test(eventType)) return "DENIED" as const;
  if (/(failed|error|invalid|quarantined)/i.test(eventType))
    return "FAILURE" as const;
  if (/(requested|queued|submitted|started|pending)/i.test(eventType))
    return "PENDING" as const;
  if (
    /(created|completed|approved|confirmed|verified|available|recorded)/i.test(
      eventType,
    )
  )
    return "SUCCESS" as const;
  return "INFORMATIONAL" as const;
}

function inferClassification(event: EventEnvelope) {
  if (/evidence|decision|assessment|proof/i.test(event.eventType))
    return "CONFIDENTIAL";
  return "INTERNAL";
}

@Injectable()
export class AuditEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly logger = new Logger(AuditEventConsumer.name);
  private consumer?: Consumer;
  private connected = false;
  private consumed = 0;
  private duplicates = 0;
  private quarantined = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.environment.KAFKA_ENABLED) return;
    let sasl: SASLOptions | undefined;
    if (
      this.environment.KAFKA_SECURITY_PROTOCOL.startsWith("SASL") &&
      this.environment.KAFKA_SASL_USERNAME &&
      this.environment.KAFKA_SASL_PASSWORD
    ) {
      const username = this.environment.KAFKA_SASL_USERNAME;
      const password = this.environment.KAFKA_SASL_PASSWORD;
      switch (this.environment.KAFKA_SASL_MECHANISM) {
        case "PLAIN":
          sasl = { mechanism: "plain", username, password };
          break;
        case "SCRAM-SHA-256":
          sasl = { mechanism: "scram-sha-256", username, password };
          break;
        default:
          sasl = { mechanism: "scram-sha-512", username, password };
      }
    }
    this.consumer = new Kafka({
      clientId: this.environment.KAFKA_CLIENT_ID,
      brokers: this.environment.KAFKA_BROKERS,
      ssl: this.environment.KAFKA_SECURITY_PROTOCOL !== "PLAINTEXT",
      ...(sasl ? { sasl } : {}),
      retry: { retries: 8, initialRetryTime: 300, maxRetryTime: 30_000 },
    }).consumer({ groupId: this.environment.KAFKA_GROUP_ID });
    await this.consumer.connect();
    this.connected = true;
    await this.consumer.subscribe({
      topics: this.environment.KAFKA_TOPICS,
      fromBeginning: true,
    });
    await this.consumer.run({
      autoCommit: true,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message }) => {
        const offset = BigInt(message.offset);
        const raw = message.value?.toString("utf8") ?? "";
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          await this.quarantine(topic, partition, offset, raw, "INVALID_JSON");
          return;
        }
        const normalized = normalizeDomainEvent(value, topic);
        if (!normalized.accepted) {
          await this.quarantine(topic, partition, offset, raw, normalized.code);
          return;
        }
        await this.append(normalized.event, topic, partition, offset);
      },
    });
  }

  async onModuleDestroy() {
    await this.consumer?.disconnect();
    this.connected = false;
  }

  health() {
    return {
      enabled: this.environment.KAFKA_ENABLED,
      connected: !this.environment.KAFKA_ENABLED || this.connected,
      consumed: this.consumed,
      duplicates: this.duplicates,
      quarantined: this.quarantined,
    };
  }

  private async quarantine(
    topic: string,
    partition: number,
    offset: bigint,
    raw: string,
    code: string,
  ) {
    await this.prisma.$transaction([
      this.prisma.quarantinedEvent.upsert({
        where: { topic_partition_offset: { topic, partition, offset } },
        create: {
          topic,
          partition,
          offset,
          payloadSha256: sha256(raw),
          safeErrorCode: code,
        },
        update: {},
      }),
      this.prisma.consumerCheckpoint.upsert({
        where: { topic_partition: { topic, partition } },
        create: { topic, partition, offset },
        update: { offset },
      }),
    ]);
    this.quarantined += 1;
    this.logger.warn({
      event: "audit.event.quarantined",
      topic,
      partition,
      offset: offset.toString(),
      code,
    });
  }

  private async append(
    event: EventEnvelope,
    topic: string,
    partition: number,
    offset: bigint,
  ) {
    const existing = await this.prisma.auditRecord.findUnique({
      where: { eventId: event.eventId },
      select: { id: true },
    });
    if (existing) {
      this.duplicates += 1;
      await this.prisma.consumerCheckpoint.upsert({
        where: { topic_partition: { topic, partition } },
        create: { topic, partition, offset, lastEventId: event.eventId },
        update: { offset, lastEventId: event.eventId },
      });
      return;
    }
    await this.prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.auditRecord.findFirst({
          where: { organizationId: event.organizationId! },
          orderBy: [{ ingestedAt: "desc" }, { id: "desc" }],
          select: {
            recordHash: true,
            occurredAt: true,
          },
        });
        const id = randomUUID();
        const occurredAt = new Date(event.occurredAt);
        const metadata = sanitizeAuditMetadata(event.payload);
        const record = {
          id,
          eventId: event.eventId,
          organizationId: event.organizationId!,
          occurredAt: occurredAt.toISOString(),
          sourceService: event.producer,
          eventType: event.eventType,
          schemaVersion: event.eventVersion,
          actorType: event.actor.type,
          actorId: event.actor.id,
          correlationId: event.correlationId,
          causationId: event.causationId,
          resourceType: event.aggregate.type,
          resourceId: event.aggregate.id,
          action: event.eventType,
          outcome: inferOutcome(event.eventType),
          classification: inferClassification(event),
          metadata,
          previousRecordHash: previous?.recordHash ?? null,
          sourceTopic: topic,
          sourcePartition: partition,
          sourceOffset: offset.toString(),
          projectionVersion: 1,
          lateArrival: Boolean(previous && occurredAt < previous.occurredAt),
        };
        await transaction.auditRecord.create({
          data: {
            ...record,
            occurredAt,
            metadata: metadata as Prisma.InputJsonValue,
            sourceOffset: offset,
            recordHash: auditRecordHash(record),
          },
        });
        await transaction.quarantinedEvent.updateMany({
          where: {
            topic,
            partition,
            offset,
            resolvedAt: null,
          },
          data: { resolvedAt: new Date() },
        });
        await transaction.consumerCheckpoint.upsert({
          where: { topic_partition: { topic, partition } },
          create: { topic, partition, offset, lastEventId: event.eventId },
          update: { offset, lastEventId: event.eventId },
        });
      },
      { isolationLevel: "Serializable" },
    );
    this.consumed += 1;
  }
}
