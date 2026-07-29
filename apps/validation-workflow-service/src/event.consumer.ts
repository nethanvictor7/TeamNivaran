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
import { kafkaOptions } from "./outbox.publisher.js";
import { PrismaService } from "./prisma.service.js";
import { CaseClient } from "./dependency-clients.js";
import { workflowConfigurationSchema } from "./rules.js";

@Injectable()
export class WorkflowEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly logger = new Logger(WorkflowEventConsumer.name);
  private consumer?: Consumer;
  constructor(
    private readonly prisma: PrismaService,
    private readonly cases: CaseClient,
  ) {}

  async onModuleInit() {
    if (!this.environment.OUTBOX_ENABLED) return;
    this.consumer = new Kafka(kafkaOptions(this.environment)).consumer({
      groupId: this.environment.WORKFLOW_CONSUMER_GROUP,
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: ["cdep.case.v1", "cdep.evidence.events.v1"],
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString("utf8") ?? "{}";
<<<<<<< HEAD
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          this.logger.warn({ event: "workflow.consumer.invalid_json" });
          return;
        }
        const parsed = eventEnvelopeSchema.safeParse(value);
=======
        const parsed = eventEnvelopeSchema.safeParse(JSON.parse(raw));
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
        if (!parsed.success) {
          this.logger.warn({ event: "workflow.consumer.invalid_event" });
          return;
        }
        const event = parsed.data;
        if (!event.organizationId) return;
        const organizationId = event.organizationId;
        const hash = createHash("sha256").update(raw).digest("hex");
        const shouldAutoStart =
          event.eventType === "case.status.changed" &&
          event.payload["toStatus"] === "OPEN";
        const caseSnapshot = shouldAutoStart
          ? await this.cases.snapshot(
              organizationId,
              event.aggregate.id,
              event.correlationId,
            )
          : undefined;
        await this.prisma.$transaction(async (tx) => {
          const prior = await tx.inboxEvent.findUnique({
            where: { eventId: event.eventId },
          });
          if (prior) return;
          if (caseSnapshot) {
            const versions = await tx.workflowDefinitionVersion.findMany({
              where: {
                status: "PUBLISHED",
                startMode: "AUTO_ON_CASE_OPENED",
                definition: {
                  isDefault: true,
                  OR: [{ organizationId }, { organizationId: null }],
                },
              },
              include: { definition: true },
              orderBy: [
                { definition: { organizationId: "desc" } },
                { versionNumber: "desc" },
              ],
            });
            const selected = versions.find((version) => {
              const configuration = workflowConfigurationSchema.parse(
                version.configuration,
              );
              return (
                configuration.caseTypes.includes("*") ||
                configuration.caseTypes.includes(caseSnapshot.caseType)
              );
            });
            const active = await tx.workflowInstance.findFirst({
              where: {
                organizationId,
                caseId: event.aggregate.id,
                active: true,
              },
            });
            if (selected && !active) {
              const aggregate = await tx.workflowInstance.aggregate({
                where: {
                  organizationId,
                  caseId: event.aggregate.id,
                },
                _max: { cycleNumber: true },
              });
              const instance = await tx.workflowInstance.create({
                data: {
                  organizationId,
                  caseId: event.aggregate.id,
                  caseNumberSnapshot: caseSnapshot.caseNumber,
                  workflowDefinitionId: selected.workflowDefinitionId,
                  workflowDefinitionVersionId: selected.id,
                  cycleNumber: (aggregate._max?.cycleNumber ?? 0) + 1,
                  startedByType: "SERVICE",
                  startedById: event.actor.id,
                },
              });
              await tx.workflowStateHistory.create({
                data: {
                  workflowInstanceId: instance.id,
                  toState: "NOT_STARTED",
                  action: "AUTO_START",
                  actorType: "SERVICE",
                  actorId: event.actor.id,
                  aggregateVersion: instance.rowVersion,
                  correlationId: event.correlationId,
                },
              });
              await tx.outboxEvent.create({
                data: {
                  aggregateType: "WorkflowInstance",
                  aggregateId: instance.id,
                  aggregateVersion: instance.rowVersion,
                  eventType: "workflow.instance.started",
                  eventVersion: "1.0",
                  payload: {
                    caseId: instance.caseId,
                    cycleNumber: instance.cycleNumber,
                    startMode: "AUTO_ON_CASE_OPENED",
                  },
                  correlationId: event.correlationId,
                  causationId: event.eventId,
                  organizationId,
                  actorType: "SERVICE",
                  actorId: event.actor.id,
                },
              });
            }
          }
          if (event.eventType === "case.cancelled") {
            const instance = await tx.workflowInstance.findFirst({
              where: {
                organizationId,
                caseId: event.aggregate.id,
                active: true,
              },
            });
            if (
              instance &&
              !["APPROVED", "REJECTED"].includes(instance.state)
            ) {
              await tx.workflowTask.updateMany({
                where: {
                  workflowInstanceId: instance.id,
                  status: { in: ["PENDING", "CLAIMED"] },
                },
                data: { status: "CANCELLED", cancelledAt: new Date() },
              });
              await tx.workflowInstance.update({
                where: { id: instance.id },
                data: {
                  state: "CANCELLED",
                  active: false,
                  cancelledAt: new Date(),
                  rowVersion: { increment: 1 },
                },
              });
              await tx.workflowStateHistory.create({
                data: {
                  workflowInstanceId: instance.id,
                  fromState: instance.state,
                  toState: "CANCELLED",
                  action: "CASE_CANCELLED",
                  actorType: "SERVICE",
                  actorId: event.actor.id,
                  aggregateVersion: instance.rowVersion + 1,
                  correlationId: event.correlationId,
                },
              });
            }
          }
          await tx.inboxEvent.create({
            data: {
              eventId: event.eventId,
              eventType: event.eventType,
              payloadHash: hash,
            },
          });
        });
      },
    });
  }
  async onModuleDestroy() {
    await this.consumer?.disconnect();
  }
}
