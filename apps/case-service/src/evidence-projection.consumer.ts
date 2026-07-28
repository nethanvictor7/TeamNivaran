import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { eventEnvelopeSchema } from "@cdep/contracts";
import { Kafka, type Consumer } from "kafkajs";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

const projectionEvents = new Set([
  "evidence.asset.created",
  "evidence.asset.linked",
  "evidence.version.available",
  "evidence.version.rejected",
  "evidence.version.failed",
]);

@Injectable()
export class EvidenceProjectionConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EvidenceProjectionConsumer.name);
  private readonly environment = getEnvironment();
  private consumer?: Consumer;
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.environment.OUTBOX_ENABLED) return;
    const sasl =
      this.environment.KAFKA_SECURITY_PROTOCOL === "SASL_SSL" &&
      this.environment.KAFKA_SASL_USERNAME &&
      this.environment.KAFKA_SASL_PASSWORD
        ? this.environment.KAFKA_SASL_MECHANISM === "PLAIN"
          ? {
              mechanism: "plain" as const,
              username: this.environment.KAFKA_SASL_USERNAME,
              password: this.environment.KAFKA_SASL_PASSWORD,
            }
          : this.environment.KAFKA_SASL_MECHANISM === "SCRAM-SHA-256"
            ? {
                mechanism: "scram-sha-256" as const,
                username: this.environment.KAFKA_SASL_USERNAME,
                password: this.environment.KAFKA_SASL_PASSWORD,
              }
            : {
                mechanism: "scram-sha-512" as const,
                username: this.environment.KAFKA_SASL_USERNAME,
                password: this.environment.KAFKA_SASL_PASSWORD,
              }
        : undefined;
    const kafka = new Kafka({
      clientId: "cdep-case-evidence-projection",
      brokers: this.environment.KAFKA_BROKERS,
      ssl: this.environment.KAFKA_SECURITY_PROTOCOL !== "PLAINTEXT",
      ...(sasl ? { sasl } : {}),
    });
    this.consumer = kafka.consumer({
      groupId: "cdep-case-evidence-projection-v1",
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: "cdep.evidence.events.v1",
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const parsed = eventEnvelopeSchema.safeParse(
          JSON.parse(message.value?.toString("utf8") ?? "{}"),
        );
        if (!parsed.success) {
          this.logger.warn({
            event: "case.evidence_projection.invalid_event",
          });
          return;
        }
        const event = parsed.data;
        if (!projectionEvents.has(event.eventType) || !event.organizationId)
          return;
        const payload = event.payload;
        const caseId =
          typeof payload.caseId === "string" ? payload.caseId : undefined;
        const evidenceNumber =
          typeof payload.evidenceNumber === "string"
            ? payload.evidenceNumber
            : undefined;
        const classificationCode =
          typeof payload.classificationCode === "string"
            ? payload.classificationCode
            : undefined;
        const evidenceStatus =
          typeof payload.evidenceStatus === "string"
            ? payload.evidenceStatus
            : undefined;
        const sourceType =
          typeof payload.sourceType === "string"
            ? payload.sourceType
            : undefined;
        if (
          !caseId ||
          !evidenceNumber ||
          !classificationCode ||
          !evidenceStatus ||
          !sourceType
        )
          return;
        const exists = await this.prisma.decisionCase.findFirst({
          where: { id: caseId, organizationId: event.organizationId },
          select: { id: true },
        });
        if (!exists) return;
        await this.prisma.$transaction(async (tx) => {
          const duplicate = await tx.inboxEvent.findUnique({
            where: { eventId: event.eventId },
          });
          if (duplicate) return;
          await tx.caseEvidenceProjection.upsert({
            where: {
              organizationId_evidenceAssetId: {
                organizationId: event.organizationId!,
                evidenceAssetId: event.aggregate.id,
              },
            },
            update: {
              caseId,
              ...(typeof payload.evidenceVersionId === "string"
                ? { currentVersionId: payload.evidenceVersionId }
                : {}),
              evidenceNumber,
              classificationCode,
              evidenceStatus,
              sourceType,
              occurredAt: new Date(event.occurredAt),
            },
            create: {
              organizationId: event.organizationId!,
              caseId,
              evidenceAssetId: event.aggregate.id,
              currentVersionId:
                typeof payload.evidenceVersionId === "string"
                  ? payload.evidenceVersionId
                  : null,
              evidenceNumber,
              classificationCode,
              evidenceStatus,
              sourceType,
              occurredAt: new Date(event.occurredAt),
            },
          });
          await tx.caseEvidenceTimelineEvent.create({
            data: {
              eventId: event.eventId,
              organizationId: event.organizationId!,
              caseId,
              evidenceAssetId: event.aggregate.id,
              eventType: event.eventType,
              evidenceStatus,
              occurredAt: new Date(event.occurredAt),
            },
          });
          await tx.inboxEvent.create({
            data: { eventId: event.eventId, eventType: event.eventType },
          });
        });
      },
    });
  }

  async onModuleDestroy() {
    await this.consumer?.disconnect();
  }
}
