import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  canonicalTriggerEventSchema,
  type CanonicalTriggerEvent,
} from "@cdep/contracts";
import type { Prisma } from "@cdep/evidence-prisma-client";
import { createHash, randomUUID } from "node:crypto";
import { Kafka, type Consumer, type Producer } from "kafkajs";
import { CaseAccessService } from "./case-access.service.js";
import { EvidenceService } from "./evidence.service.js";
import { getEnvironment } from "./environment.js";
import { kafkaOptions } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class SourceTriggerConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourceTriggerConsumer.name);
  private readonly environment = getEnvironment();
  private consumer?: Consumer;
  private dlt?: Producer;
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cases: CaseAccessService,
    private readonly evidence: EvidenceService,
  ) {}

  async onModuleInit() {
    if (!this.environment.OUTBOX_ENABLED) return;
    const kafka = new Kafka({
      ...kafkaOptions(this.environment),
      clientId: `${this.environment.KAFKA_CLIENT_ID}-source-consumer`,
    });
    this.consumer = kafka.consumer({
      groupId: "cdep-evidence-source-reference-v1",
      allowAutoTopicCreation: true,
    });
    this.dlt = kafka.producer();
    await Promise.all([this.consumer.connect(), this.dlt.connect()]);
    await this.consumer.subscribe({
      topic: "cdep.integration.trigger.v1",
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: async ({ message, topic, partition }) => {
        const raw = message.value?.toString("utf8") ?? "";
        let eventId: string = randomUUID();
        try {
          const value = JSON.parse(raw) as unknown;
          if (
            value &&
            typeof value === "object" &&
            "eventId" in value &&
            typeof value.eventId === "string"
          )
            eventId = value.eventId;
          const event = canonicalTriggerEventSchema.parse(value);
          await this.process(event);
          this.failures.delete(eventId);
        } catch (error) {
          const attempts = (this.failures.get(eventId) ?? 0) + 1;
          this.failures.set(eventId, attempts);
          if (attempts < this.environment.EVIDENCE_PROCESSING_MAX_ATTEMPTS)
            throw error;
          await this.recordFailure(eventId, error);
          await this.dlt?.send({
            topic: "cdep.evidence.dlt.v1",
            messages: [
              {
                key: eventId,
                value: JSON.stringify({
                  eventId,
                  sourceTopic: topic,
                  partition,
                  payloadSha256: createHash("sha256").update(raw).digest("hex"),
                  failureCode: "SOURCE_EVENT_INVALID_OR_EXHAUSTED",
                  occurredAt: new Date().toISOString(),
                }),
              },
            ],
          });
          this.logger.error({
            event: "evidence.source_trigger.dlt",
            eventId,
            attempts,
            code: "SOURCE_EVENT_INVALID_OR_EXHAUSTED",
          });
        }
      },
    });
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.consumer?.disconnect(),
      this.dlt?.disconnect(),
    ]);
  }

  private async process(event: CanonicalTriggerEvent) {
    const existing = await this.prisma.inboxEvent.findUnique({
      where: { eventId: event.eventId },
    });
    if (existing) return;
    const organizationId = event.organizationId;
    const caseId = event.journey.caseId;
    const reference = event.data.evidenceReference;
    if (
      event.source.triggerType !== "evidence.reference.received" ||
      !organizationId ||
      !caseId ||
      !reference
    ) {
      await this.prisma.inboxEvent.create({
        data: {
          eventId: event.eventId,
          ...(organizationId ? { organizationId } : {}),
          eventType: event.eventType,
          status: "IGNORED",
          failureCode: "NOT_EXPLICIT_RESOLVED_EVIDENCE_REFERENCE",
        },
      });
      return;
    }
    await this.cases.assertAccessible(
      caseId,
      organizationId,
      event.journey.correlationId,
    );
    await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.inboxEvent.findUnique({
        where: { eventId: event.eventId },
      });
      if (duplicate) return;
      const sourceDuplicate = await tx.evidenceAsset.findFirst({
        where: {
          organizationId,
          sourceTriggerId: event.rawPayloadReference,
        },
      });
      if (sourceDuplicate) {
        await tx.inboxEvent.create({
          data: {
            eventId: event.eventId,
            organizationId,
            eventType: event.eventType,
            status: "PROCESSED",
          },
        });
        return;
      }
      const classification = await tx.evidenceClassification.findFirst({
        where: {
          code: reference.classificationCode,
          active: true,
          OR: [{ organizationId: null }, { organizationId }],
        },
      });
      if (!classification) {
        await tx.inboxEvent.create({
          data: {
            eventId: event.eventId,
            organizationId,
            eventType: event.eventType,
            status: "IGNORED",
            failureCode: "CLASSIFICATION_INACTIVE",
          },
        });
        return;
      }
      const sequence = await tx.$queryRaw<Array<{ value: bigint }>>`
        SELECT nextval('evidence_number_seq') AS value
      `;
      const value = sequence[0]?.value;
      if (value === undefined)
        throw new Error("Evidence number allocation failed.");
      const asset = await tx.evidenceAsset.create({
        data: {
          organizationId,
          evidenceNumber: `EV-${new Date()
            .getUTCFullYear()
            .toString()}-${value.toString().padStart(7, "0")}`,
          primaryCaseId: caseId,
          classificationCode: reference.classificationCode,
          title: reference.title,
          ...(reference.description
            ? { description: reference.description }
            : {}),
          sourceType: "SOURCE_TRIGGER_REFERENCE",
          sourceSystemId: event.source.systemId,
          connectorId: event.source.connectorId,
          sourceTriggerId: event.rawPayloadReference,
          externalReference: reference.externalReference,
          status: "AWAITING_CONTENT",
          createdByType: "SERVICE",
          createdById: "integration-ingestion-service",
          updatedBy: "integration-ingestion-service",
        },
      });
      await tx.evidenceCaseLink.create({
        data: {
          organizationId,
          evidenceAssetId: asset.id,
          caseId,
          linkedBy: "integration-ingestion-service",
        },
      });
      await tx.inboxEvent.create({
        data: {
          eventId: event.eventId,
          organizationId,
          eventType: event.eventType,
          status: "PROCESSED",
        },
      });
      await this.evidence.event(tx, {
        asset,
        identity: { userId: "integration-ingestion-service" },
        actorType: "SERVICE",
        correlationId: event.journey.correlationId,
        causationId: event.eventId,
        eventType: "evidence.asset.created",
        payload: {
          evidenceNumber: asset.evidenceNumber,
          caseId,
          classificationCode: asset.classificationCode,
          evidenceStatus: asset.status,
          sourceType: asset.sourceType,
          sourceSystemId: asset.sourceSystemId,
          connectorId: asset.connectorId,
          sourceTriggerId: asset.sourceTriggerId,
        },
      });
      await this.evidence.event(tx, {
        asset,
        identity: { userId: "integration-ingestion-service" },
        actorType: "SERVICE",
        correlationId: event.journey.correlationId,
        causationId: event.eventId,
        eventType: "evidence.asset.linked",
        payload: {
          evidenceNumber: asset.evidenceNumber,
          caseId,
          classificationCode: asset.classificationCode,
          evidenceStatus: asset.status,
          sourceType: asset.sourceType,
        },
      });
    });
  }

  private async recordFailure(eventId: string, error: unknown) {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return;
    await this.prisma.inboxEvent.upsert({
      where: { eventId },
      update: {
        status: "FAILED",
        failureCode: "SOURCE_EVENT_INVALID_OR_EXHAUSTED",
      },
      create: {
        eventId,
        eventType: "source.trigger.received",
        status: "FAILED",
        failureCode: "SOURCE_EVENT_INVALID_OR_EXHAUSTED",
      },
    });
  }
}
