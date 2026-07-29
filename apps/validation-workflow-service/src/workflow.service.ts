import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Prisma,
  type WorkflowInstance,
  type WorkflowState,
} from "@cdep/workflow-prisma-client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { WorkflowIdentity } from "./authentication.js";
import {
  CaseClient,
  EvidenceClient,
  IdentityClient,
} from "./dependency-clients.js";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";
import {
  evaluateRules,
  type EvidenceSnapshotItem,
  workflowConfigurationSchema,
} from "./rules.js";

const uuid = z.uuid();
const expectedVersion = z.number().int().positive();
const boundedText = z.string().trim().min(3).max(4000);
const reasonCodes = z
  .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/))
  .min(1)
  .max(20);

export const createDefinitionSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9-]{2,79}$/),
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(1000).optional(),
    isDefault: z.boolean().default(false),
  })
  .strict();
export const updateDefinitionSchema = createDefinitionSchema
  .partial()
  .extend({ expectedVersion });
export const definitionVersionSchema = z
  .object({
    startMode: z.enum(["MANUAL", "AUTO_ON_CASE_OPENED"]).default("MANUAL"),
    warningPolicy: z.enum(["BLOCKING", "NON_BLOCKING"]).default("NON_BLOCKING"),
    fourEyesEnabled: z.boolean().default(true),
    prohibitEvidenceSubmitterApproval: z.boolean().default(false),
    prohibitReviewerApproval: z.boolean().default(false),
    defaultReviewDueHours: z.number().int().min(1).max(720).default(24),
    defaultDecisionDueHours: z.number().int().min(1).max(720).default(24),
    configuration: workflowConfigurationSchema,
  })
  .strict();
export const startSchema = z
  .object({ definitionVersionId: uuid.optional() })
  .strict();
export const versionCommandSchema = z.object({ expectedVersion }).strict();
export const claimSchema = z.object({ taskVersion: expectedVersion }).strict();
export const assignSchema = z
  .object({ taskVersion: expectedVersion, userId: uuid })
  .strict();
export const commentSchema = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict();
export const reviewSchema = z
  .object({
    workflowVersion: expectedVersion,
    taskVersion: expectedVersion,
    outcome: z.enum(["READY_FOR_RECOMMENDATION", "CORRECTION_REQUIRED"]),
    reasonCodes,
    rationale: boundedText,
    evidenceVersionIds: z.array(uuid).min(1).max(100),
  })
  .strict();
export const correctionSchema = z
  .object({
    workflowVersion: expectedVersion,
    taskVersion: expectedVersion,
    targetType: z.enum([
      "CASE_DATA",
      "EVIDENCE_CLASSIFICATION",
      "EVIDENCE_ASSET",
      "GENERAL_INFORMATION",
    ]),
    targetId: uuid.optional(),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    rationale: boundedText,
  })
  .strict();
export const recommendationSchema = z
  .object({
    workflowVersion: expectedVersion,
    outcome: z.enum([
      "RECOMMEND_APPROVAL",
      "RECOMMEND_REJECTION",
      "REQUEST_MORE_INFORMATION",
    ]),
    reasonCodes,
    rationale: boundedText,
    conditions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    supportingAssessmentIds: z.array(uuid).max(20).default([]),
  })
  .strict();
export const decisionSchema = z
  .object({
    workflowVersion: expectedVersion,
    taskVersion: expectedVersion,
    reasonCodes,
    rationale: boundedText,
  })
  .strict();
export const withdrawSchema = z
  .object({
    expectedVersion,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export const reopenSchema = z
  .object({
    definitionVersionId: uuid.optional(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const terminalStates = new Set<WorkflowState>([
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "CANCELLED",
]);

@Injectable()
export class WorkflowService {
  private readonly environment = getEnvironment();
  constructor(
    private readonly prisma: PrismaService,
    private readonly cases: CaseClient,
    private readonly evidence: EvidenceClient,
    private readonly identities: IdentityClient,
  ) {}

  async createDefinition(
    input: z.infer<typeof createDefinitionSchema>,
    identity: WorkflowIdentity,
  ) {
    return this.prisma.workflowDefinition.create({
      data: {
        organizationId: identity.organizationId,
        code: input.code,
        name: input.name,
        isDefault: input.isDefault,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        createdBy: identity.userId,
        updatedBy: identity.userId,
      },
    });
  }

  listDefinitions(identity: WorkflowIdentity) {
    return this.prisma.workflowDefinition.findMany({
      where: {
        OR: [
          { organizationId: identity.organizationId },
          { organizationId: null },
        ],
      },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
      orderBy: [{ organizationId: "desc" }, { code: "asc" }],
    });
  }

  async getDefinition(id: string, identity: WorkflowIdentity) {
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: {
        id,
        OR: [
          { organizationId: identity.organizationId },
          { organizationId: null },
        ],
      },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
    if (!definition)
      throw new NotFoundException("Workflow definition not found.");
    return definition;
  }

  async updateDefinition(
    id: string,
    input: z.infer<typeof updateDefinitionSchema>,
    identity: WorkflowIdentity,
  ) {
    const { expectedVersion: version, ...data } = input;
    const updateData: Prisma.WorkflowDefinitionUpdateManyMutationInput = {
      updatedBy: identity.userId,
      rowVersion: { increment: 1 },
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
    };
    const changed = await this.prisma.workflowDefinition.updateMany({
      where: {
        id,
        organizationId: identity.organizationId,
        rowVersion: version,
        status: "DRAFT",
      },
      data: updateData,
    });
    if (changed.count !== 1)
      throw new ConflictException(
        "The draft definition changed or is immutable.",
      );
    return this.getDefinition(id, identity);
  }

  async createVersion(
    definitionId: string,
    input: z.infer<typeof definitionVersionSchema>,
    identity: WorkflowIdentity,
  ) {
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: { id: definitionId, organizationId: identity.organizationId },
    });
    if (!definition)
      throw new NotFoundException("Workflow definition not found.");
    const aggregate = await this.prisma.workflowDefinitionVersion.aggregate({
      where: { workflowDefinitionId: definitionId },
      _max: { versionNumber: true },
    });
    return this.prisma.workflowDefinitionVersion.create({
      data: {
        workflowDefinitionId: definitionId,
        versionNumber: (aggregate._max.versionNumber ?? 0) + 1,
        ...input,
        configuration: input.configuration as Prisma.InputJsonValue,
        createdBy: identity.userId,
      },
    });
  }

  async updateVersion(
    definitionId: string,
    versionId: string,
    input: z.infer<typeof definitionVersionSchema>,
    identity: WorkflowIdentity,
  ) {
    await this.assertOwnedDefinition(definitionId, identity);
    const version = await this.prisma.workflowDefinitionVersion.findFirst({
      where: {
        id: versionId,
        workflowDefinitionId: definitionId,
        status: "DRAFT",
      },
    });
    if (!version)
      throw new ConflictException(
        "Only an unpublished definition version can be changed.",
      );
    return this.prisma.workflowDefinitionVersion.update({
      where: { id: versionId },
      data: {
        ...input,
        configuration: input.configuration as Prisma.InputJsonValue,
      },
    });
  }

  async publishVersion(
    definitionId: string,
    versionId: string,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    await this.assertOwnedDefinition(definitionId, identity);
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.workflowDefinitionVersion.findFirst({
        where: {
          id: versionId,
          workflowDefinitionId: definitionId,
          status: "DRAFT",
        },
      });
      if (!version)
        throw new ConflictException(
          "The definition version is already immutable.",
        );
      workflowConfigurationSchema.parse(version.configuration);
      const published = await tx.workflowDefinitionVersion.update({
        where: { id: version.id },
        data: {
          status: "PUBLISHED",
          publishedBy: identity.userId,
          publishedAt: new Date(),
        },
      });
      await tx.workflowDefinition.update({
        where: { id: definitionId },
        data: {
          status: "PUBLISHED",
          updatedBy: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "WorkflowDefinition",
          aggregateId: definitionId,
          aggregateVersion: published.versionNumber,
          eventType: "workflow.definition.published",
          eventVersion: "1.0",
          payload: {
            definitionId,
            definitionVersionId: published.id,
            versionNumber: published.versionNumber,
          },
          correlationId,
          organizationId: identity.organizationId,
          actorType: "USER",
          actorId: identity.userId,
        },
      });
      return published;
    });
  }

  async retireVersion(
    definitionId: string,
    versionId: string,
    identity: WorkflowIdentity,
  ) {
    await this.assertOwnedDefinition(definitionId, identity);
    const result = await this.prisma.workflowDefinitionVersion.updateMany({
      where: {
        id: versionId,
        workflowDefinitionId: definitionId,
        status: "PUBLISHED",
      },
      data: {
        status: "RETIRED",
        retiredBy: identity.userId,
        retiredAt: new Date(),
      },
    });
    if (result.count !== 1)
      throw new ConflictException("Only a published version can be retired.");
    return this.prisma.workflowDefinitionVersion.findUnique({
      where: { id: versionId },
    });
  }

  async start(
    caseId: string,
    input: z.infer<typeof startSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
    idempotencyKey: string,
    reopen?: { priorWorkflowInstanceId: string; reason: string },
  ) {
    if (!idempotencyKey)
      throw new BadRequestException("Idempotency-Key is required.");
    const requestHash = hash(input);
    const route = `cases/${caseId}/workflow/start`;
    const prior = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_actorId_route_key: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key: idempotencyKey,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ConflictException(
          "Idempotency key was used for a different request.",
        );
      return prior.responseBody;
    }
    const caseSnapshot = await this.cases.snapshot(
      identity.organizationId,
      caseId,
      correlationId,
    );
    if (
      !reopen &&
      !["OPEN", "EVIDENCE_COLLECTION", "UNDER_REVIEW"].includes(
        caseSnapshot.status,
      )
    )
      throw new UnprocessableEntityException(
        "The Case state does not permit Workflow start.",
      );
    const selected = input.definitionVersionId
      ? await this.prisma.workflowDefinitionVersion.findFirst({
          where: {
            id: input.definitionVersionId,
            status: "PUBLISHED",
            definition: {
              OR: [
                { organizationId: identity.organizationId },
                { organizationId: null },
              ],
            },
          },
          include: { definition: true },
        })
      : await this.prisma.workflowDefinitionVersion.findFirst({
          where: {
            status: "PUBLISHED",
            definition: {
              isDefault: true,
              OR: [
                { organizationId: identity.organizationId },
                { organizationId: null },
              ],
            },
          },
          include: { definition: true },
          orderBy: [
            { definition: { organizationId: "desc" } },
            { versionNumber: "desc" },
          ],
        });
    if (!selected)
      throw new UnprocessableEntityException(
        "No applicable published Workflow definition exists.",
      );
    const configuration = workflowConfigurationSchema.parse(
      selected.configuration,
    );
    if (
      !configuration.caseTypes.includes("*") &&
      !configuration.caseTypes.includes(caseSnapshot.caseType)
    )
      throw new UnprocessableEntityException(
        "The Workflow definition does not apply to this Case type.",
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const active = await tx.workflowInstance.findFirst({
          where: {
            organizationId: identity.organizationId,
            caseId,
            active: true,
          },
        });
        if (active)
          throw new ConflictException(
            "An active Workflow already exists for this Case.",
          );
        const aggregate = await tx.workflowInstance.aggregate({
          where: { organizationId: identity.organizationId, caseId },
          _max: { cycleNumber: true },
        });
        const instance = await tx.workflowInstance.create({
          data: {
            organizationId: identity.organizationId,
            caseId,
            caseNumberSnapshot: caseSnapshot.caseNumber,
            workflowDefinitionId: selected.definition.id,
            workflowDefinitionVersionId: selected.id,
            cycleNumber: (aggregate._max.cycleNumber ?? 0) + 1,
            startedById: identity.userId,
          },
        });
        const startedAction = reopen ? "WORKFLOW_REOPENED" : "WORKFLOW_STARTED";
        await tx.workflowStateHistory.create({
          data: {
            workflowInstanceId: instance.id,
            toState: "NOT_STARTED",
            action: startedAction,
            ...(reopen ? { reasonCode: reopen.reason.slice(0, 80) } : {}),
            actorType: "USER",
            actorId: identity.userId,
            aggregateVersion: 1,
            correlationId,
          },
        });
        await tx.workflowActionActor.create({
          data: {
            workflowInstanceId: instance.id,
            action: startedAction,
            actorId: identity.userId,
            ...(reopen ? { referenceId: reopen.priorWorkflowInstanceId } : {}),
          },
        });
        await this.event(
          tx,
          instance,
          identity,
          correlationId,
          reopen ? "workflow.reopened" : "workflow.instance.started",
          {
            caseId,
            cycleNumber: instance.cycleNumber,
            ...(reopen
              ? {
                  priorWorkflowInstanceId: reopen.priorWorkflowInstanceId,
                  reason: reopen.reason,
                }
              : {}),
          },
        );
        const response = this.serialize(instance);
        await tx.idempotencyRecord.create({
          data: {
            organizationId: identity.organizationId,
            actorId: identity.userId,
            route,
            key: idempotencyKey,
            requestHash,
            responseStatus: 201,
            responseBody: response as Prisma.InputJsonValue,
          },
        });
        return response;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "An active Workflow already exists for this Case.",
        );
      throw error;
    }
  }

  async getCaseWorkflow(
    caseId: string,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const instances = await this.prisma.workflowInstance.findMany({
      where: { organizationId: identity.organizationId, caseId },
      include: {
        definitionVersion: { include: { definition: true } },
        history: { orderBy: { occurredAt: "asc" } },
        validations: {
          include: { results: true },
          orderBy: { runNumber: "desc" },
        },
        tasks: { orderBy: { createdAt: "desc" } },
        reviews: { orderBy: { submittedAt: "desc" } },
        corrections: { orderBy: { requestedAt: "desc" } },
        recommendations: { orderBy: { submittedAt: "desc" } },
        decisions: true,
      },
      orderBy: { cycleNumber: "desc" },
    });
    if (instances.length === 0)
      await this.cases.snapshot(identity.organizationId, caseId, correlationId);
    return { items: instances.map((item) => this.serialize(item)) };
  }

  async history(caseId: string, identity: WorkflowIdentity) {
    const instances = await this.prisma.workflowInstance.findMany({
      where: { organizationId: identity.organizationId, caseId },
      select: { id: true },
    });
    return this.prisma.workflowStateHistory.findMany({
      where: { workflowInstanceId: { in: instances.map((item) => item.id) } },
      orderBy: { occurredAt: "asc" },
    });
  }

  async validate(
    caseId: string,
    input: z.infer<typeof versionCommandSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
    triggerType = "MANUAL",
  ) {
    const instance = await this.activeInstance(caseId, identity.organizationId);
    if (terminalStates.has(instance.state))
      throw new ConflictException("A terminal Workflow cannot be validated.");
    if (instance.rowVersion !== input.expectedVersion)
      throw new ConflictException("The Workflow was updated by another actor.");
    const [caseSnapshot, evidenceSnapshot, version] = await Promise.all([
      this.cases.snapshot(identity.organizationId, caseId, correlationId),
      this.evidence.snapshot(identity.organizationId, caseId, correlationId),
      this.prisma.workflowDefinitionVersion.findUniqueOrThrow({
        where: { id: instance.workflowDefinitionVersionId },
      }),
    ]);
    const configuration = workflowConfigurationSchema.parse(
      version.configuration,
    );
    const results = evaluateRules(
      configuration,
      caseSnapshot as unknown as Record<string, unknown>,
      evidenceSnapshot.items,
    );
    const failed = results.some(
      (result) =>
        result.status === "FAIL" ||
        result.status === "ERROR" ||
        (result.status === "WARNING" && version.warningPolicy === "BLOCKING"),
    );
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.workflowInstance.findFirst({
        where: {
          id: instance.id,
          organizationId: identity.organizationId,
          rowVersion: input.expectedVersion,
          active: true,
        },
      });
      if (!fresh)
        throw new ConflictException(
          "The Workflow was updated by another actor.",
        );
      const count = await tx.validationRun.count({
        where: { workflowInstanceId: fresh.id },
      });
      const run = await tx.validationRun.create({
        data: {
          organizationId: identity.organizationId,
          workflowInstanceId: fresh.id,
          runNumber: count + 1,
          triggerType,
          status: failed ? "FAIL" : "PASS",
          definitionVersionId: version.id,
          caseSnapshot: caseSnapshot as unknown as Prisma.InputJsonValue,
          evidenceSnapshot:
            evidenceSnapshot.items as unknown as Prisma.InputJsonValue,
          startedByType: "USER",
          startedById: identity.userId,
          completedAt: new Date(),
          results: {
            create: results.map((result) => ({
              ...result,
              safeParameters: result.safeParameters as Prisma.InputJsonValue,
              inputReferences: result.inputReferences as Prisma.InputJsonValue,
            })),
          },
        },
        include: { results: true },
      });
      await tx.workflowTask.updateMany({
        where: {
          workflowInstanceId: fresh.id,
          status: { in: ["PENDING", "CLAIMED"] },
        },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      const nextState: WorkflowState = failed
        ? "EVIDENCE_REQUIRED"
        : "READY_FOR_REVIEW";
      const task = await tx.workflowTask.create({
        data: {
          organizationId: identity.organizationId,
          workflowInstanceId: fresh.id,
          caseId,
          taskType: failed ? "PROVIDE_EVIDENCE" : "REVIEW_CASE",
          requiredPermission: failed ? "evidence:upload" : "review:submit",
          eligibleRoleCodes: failed ? ["analyst"] : ["reviewer"],
          dueAt: new Date(
            Date.now() + version.defaultReviewDueHours * 60 * 60 * 1000,
          ),
        },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: fresh.id },
        data: {
          state: nextState,
          currentValidationRunId: run.id,
          activeTaskId: task.id,
          caseSyncStatus: "PENDING",
          rowVersion: { increment: 1 },
        },
      });
      await this.transitionRecord(
        tx,
        fresh,
        updated,
        "VALIDATION_COMPLETED",
        identity,
        correlationId,
      );
      await this.event(
        tx,
        updated,
        identity,
        correlationId,
        "validation.run.completed",
        {
          caseId,
          validationRunId: run.id,
          status: run.status,
          resultCounts: {
            passed: results.filter((result) => result.status === "PASS").length,
            failed: results.filter((result) => result.status === "FAIL").length,
          },
        },
      );
      await this.queueSync(
        tx,
        updated,
        failed ? "EVIDENCE_COLLECTION" : "UNDER_REVIEW",
        "workflow.validation.case-sync",
      );
      return {
        workflow: this.serialize(updated),
        validationRun: this.serialize(run),
        task,
      };
    });
  }

  async validations(caseId: string, identity: WorkflowIdentity) {
    const instances = await this.prisma.workflowInstance.findMany({
      where: { organizationId: identity.organizationId, caseId },
      select: { id: true },
    });
    return this.prisma.validationRun.findMany({
      where: { workflowInstanceId: { in: instances.map((item) => item.id) } },
      include: { results: true },
      orderBy: [{ startedAt: "desc" }],
    });
  }

  async tasks(
    identity: WorkflowIdentity,
    query: Record<string, string | undefined>,
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where: Prisma.WorkflowTaskWhereInput = {
      organizationId: identity.organizationId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.taskType ? { taskType: query.taskType } : {}),
      ...(query.assignedToMe === "true"
        ? {
            OR: [
              { assignedUserId: identity.userId },
              { claimedBy: identity.userId },
            ],
          }
        : {}),
      ...(query.overdue === "true"
        ? { dueAt: { lt: new Date() }, status: { in: ["PENDING", "CLAIMED"] } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workflowTask.findMany({
        where,
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.workflowTask.count({ where }),
    ]);
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async task(taskId: string, identity: WorkflowIdentity) {
    const task = await this.prisma.workflowTask.findFirst({
      where: { id: taskId, organizationId: identity.organizationId },
      include: {
        instance: {
          include: {
            validations: {
              include: { results: true },
              orderBy: { runNumber: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!task) throw new NotFoundException("Workflow task not found.");
    return this.serialize(task);
  }

  async claim(
    taskId: string,
    input: z.infer<typeof claimSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const task = await this.taskRow(taskId, identity.organizationId);
    const eligibility = await this.identities.eligibility(
      identity.organizationId,
      identity.userId,
      task.requiredPermission,
      correlationId,
    );
    if (!eligibility.eligible)
      throw new ForbiddenException(
        "The current user is not eligible for this task.",
      );
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.workflowTask.updateMany({
        where: {
          id: taskId,
          organizationId: identity.organizationId,
          status: "PENDING",
          rowVersion: input.taskVersion,
          OR: [{ assignedUserId: null }, { assignedUserId: identity.userId }],
        },
        data: {
          status: "CLAIMED",
          claimedBy: identity.userId,
          claimedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "The task was claimed or changed by another user.",
        );
      await tx.taskAssignmentHistory.create({
        data: {
          workflowTaskId: taskId,
          action: "CLAIMED",
          actorId: identity.userId,
          fromUserId: task.assignedUserId,
          toUserId: identity.userId,
          taskVersion: input.taskVersion + 1,
        },
      });
      if (task.taskType === "REVIEW_CASE") {
        const previous = await tx.workflowInstance.findFirst({
          where: {
            id: task.workflowInstanceId,
            state: "READY_FOR_REVIEW",
          },
        });
        if (previous) {
          const updated = await tx.workflowInstance.update({
            where: { id: previous.id },
            data: { state: "UNDER_REVIEW", rowVersion: { increment: 1 } },
          });
          await this.transitionRecord(
            tx,
            previous,
            updated,
            "START_REVIEW",
            identity,
            correlationId,
          );
          await this.event(
            tx,
            updated,
            identity,
            correlationId,
            "workflow.review.started",
            { caseId: updated.caseId, taskId },
          );
        }
      }
    });
    return this.task(taskId, identity);
  }

  async assign(
    taskId: string,
    input: z.infer<typeof assignSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const task = await this.taskRow(taskId, identity.organizationId);
    const eligibility = await this.identities.eligibility(
      identity.organizationId,
      input.userId,
      task.requiredPermission,
      correlationId,
    );
    if (!eligibility.eligible)
      throw new UnprocessableEntityException(
        "The selected user is not eligible for this task.",
      );
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.workflowTask.updateMany({
        where: {
          id: taskId,
          organizationId: identity.organizationId,
          status: { in: ["PENDING", "CLAIMED"] },
          rowVersion: input.taskVersion,
        },
        data: {
          assignedUserId: input.userId,
          claimedBy: null,
          claimedAt: null,
          status: "PENDING",
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("The task was updated by another user.");
      await tx.taskAssignmentHistory.create({
        data: {
          workflowTaskId: taskId,
          action: "ASSIGNED",
          actorId: identity.userId,
          fromUserId: task.assignedUserId,
          toUserId: input.userId,
          taskVersion: input.taskVersion + 1,
        },
      });
    });
    return this.task(taskId, identity);
  }

  async addComment(
    taskId: string,
    input: z.infer<typeof commentSchema>,
    identity: WorkflowIdentity,
  ) {
    const task = await this.taskRow(taskId, identity.organizationId);
    return this.prisma.workflowComment.create({
      data: {
        organizationId: identity.organizationId,
        workflowInstanceId: task.workflowInstanceId,
        taskId,
        authorId: identity.userId,
        body: input.body,
      },
    });
  }

  async submitReview(
    taskId: string,
    input: z.infer<typeof reviewSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const task = await this.taskRow(taskId, identity.organizationId);
    if (task.taskType !== "REVIEW_CASE" || task.status !== "CLAIMED")
      throw new ConflictException("An active claimed review task is required.");
    if (
      task.claimedBy !== identity.userId &&
      task.assignedUserId !== identity.userId
    )
      throw new ForbiddenException("This review task belongs to another user.");
    const instance = await this.instanceById(
      task.workflowInstanceId,
      identity.organizationId,
    );
    if (instance.rowVersion !== input.workflowVersion)
      throw new ConflictException("The Workflow was updated by another actor.");
    const validation = await this.currentValidation(instance);
    const pinned =
      validation.evidenceSnapshot as unknown as EvidenceSnapshotItem[];
    const current = await this.evidence.snapshot(
      identity.organizationId,
      instance.caseId,
      correlationId,
    );
    this.assertSnapshotCurrent(pinned, current.items, input.evidenceVersionIds);
    return this.prisma.$transaction(async (tx) => {
      const freshTask = await tx.workflowTask.findFirst({
        where: {
          id: taskId,
          rowVersion: input.taskVersion,
          status: "CLAIMED",
          claimedBy: identity.userId,
        },
      });
      const fresh = await tx.workflowInstance.findFirst({
        where: {
          id: instance.id,
          rowVersion: input.workflowVersion,
          active: true,
        },
      });
      if (!freshTask || !fresh)
        throw new ConflictException(
          "The Workflow or task was updated by another actor.",
        );
      const review = await tx.reviewSubmission.create({
        data: {
          workflowInstanceId: fresh.id,
          validationRunId: validation.id,
          cycleNumber: fresh.cycleNumber,
          actorId: identity.userId,
          outcome: input.outcome,
          reasonCodes: input.reasonCodes,
          rationale: input.rationale,
          evidenceSnapshot: pinned as unknown as Prisma.InputJsonValue,
          aggregateVersion: fresh.rowVersion + 1,
        },
      });
      await tx.reviewSubmissionEvidence.createMany({
        data: this.evidenceSnapshotRows(
          fresh.id,
          pinned,
          "reviewSubmissionId",
          review.id,
        ),
      });
      await tx.workflowActionActor.create({
        data: {
          workflowInstanceId: fresh.id,
          action: "REVIEW_SUBMITTED",
          actorId: identity.userId,
          referenceId: review.id,
        },
      });
      await tx.workflowTask.update({
        where: { id: freshTask.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      const correction = input.outcome === "CORRECTION_REQUIRED";
      const nextTask = await tx.workflowTask.create({
        data: {
          organizationId: identity.organizationId,
          workflowInstanceId: fresh.id,
          caseId: fresh.caseId,
          taskType: correction ? "CORRECT_SUBMISSION" : "CREATE_RECOMMENDATION",
          requiredPermission: correction
            ? "evidence:upload"
            : "decision:recommend",
          eligibleRoleCodes: correction ? ["analyst"] : ["recommender"],
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      if (correction)
        await tx.correctionRequest.create({
          data: {
            workflowInstanceId: fresh.id,
            requestedBy: identity.userId,
            targetType: "GENERAL_INFORMATION",
            reasonCode: input.reasonCodes[0]!,
            rationale: input.rationale,
          },
        });
      const updated = await tx.workflowInstance.update({
        where: { id: fresh.id },
        data: {
          state: correction
            ? "CORRECTION_REQUESTED"
            : "READY_FOR_RECOMMENDATION",
          activeTaskId: nextTask.id,
          rowVersion: { increment: 1 },
        },
      });
      await this.transitionRecord(
        tx,
        fresh,
        updated,
        correction ? "REQUEST_CORRECTION" : "SUBMIT_REVIEW",
        identity,
        correlationId,
      );
      await this.event(
        tx,
        updated,
        identity,
        correlationId,
        correction
          ? "workflow.correction.requested"
          : "workflow.review.submitted",
        {
          caseId: fresh.caseId,
          reviewSubmissionId: review.id,
          outcome: input.outcome,
        },
      );
      return {
        review: this.serialize(review),
        workflow: this.serialize(updated),
        task: nextTask,
      };
    });
  }

  async requestCorrection(
    taskId: string,
    input: z.infer<typeof correctionSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const task = await this.taskRow(taskId, identity.organizationId);
    const instance = await this.instanceById(
      task.workflowInstanceId,
      identity.organizationId,
    );
    if (instance.rowVersion !== input.workflowVersion)
      throw new ConflictException("The Workflow was updated by another actor.");
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.workflowTask.updateMany({
        where: {
          id: task.id,
          rowVersion: input.taskVersion,
          status: { in: ["PENDING", "CLAIMED"] },
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("The task was updated by another actor.");
      const correction = await tx.correctionRequest.create({
        data: {
          workflowInstanceId: instance.id,
          requestedBy: identity.userId,
          targetType: input.targetType,
          ...(input.targetId ? { targetId: input.targetId } : {}),
          reasonCode: input.reasonCode,
          rationale: input.rationale,
        },
      });
      const nextTask = await tx.workflowTask.create({
        data: {
          organizationId: identity.organizationId,
          workflowInstanceId: instance.id,
          caseId: instance.caseId,
          taskType: "CORRECT_SUBMISSION",
          requiredPermission: "evidence:upload",
          eligibleRoleCodes: ["analyst"],
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: {
          state: "CORRECTION_REQUESTED",
          activeTaskId: nextTask.id,
          rowVersion: { increment: 1 },
        },
      });
      await this.transitionRecord(
        tx,
        instance,
        updated,
        "REQUEST_CORRECTION",
        identity,
        correlationId,
        input.reasonCode,
      );
      return { correction, workflow: this.serialize(updated), task: nextTask };
    });
  }

  async resubmit(
    caseId: string,
    input: z.infer<typeof versionCommandSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const instance = await this.activeInstance(caseId, identity.organizationId);
    if (instance.state !== "CORRECTION_REQUESTED")
      throw new ConflictException(
        "Only a correction-requested Workflow can be resubmitted.",
      );
    const correctionTask = await this.prisma.workflowTask.findFirst({
      where: {
        workflowInstanceId: instance.id,
        taskType: "CORRECT_SUBMISSION",
        status: { in: ["PENDING", "CLAIMED"] },
      },
    });
    if (!correctionTask)
      throw new ConflictException("No active correction task exists.");
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowTask.update({
        where: { id: correctionTask.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await tx.correctionRequest.updateMany({
        where: { workflowInstanceId: instance.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    });
    return this.validate(
      caseId,
      input,
      identity,
      correlationId,
      "RESUBMISSION",
    );
  }

  async recommend(
    caseId: string,
    input: z.infer<typeof recommendationSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const instance = await this.activeInstance(caseId, identity.organizationId);
    if (
      instance.state !== "READY_FOR_RECOMMENDATION" ||
      instance.rowVersion !== input.workflowVersion
    )
      throw new ConflictException(
        "The Workflow is not ready for this recommendation.",
      );
    const validation = await this.currentValidation(instance);
    const evidence =
      validation.evidenceSnapshot as unknown as EvidenceSnapshotItem[];
    const current = await this.evidence.snapshot(
      identity.organizationId,
      caseId,
      correlationId,
    );
    this.assertSnapshotCurrent(
      evidence,
      current.items,
      evidence.map((item) => item.evidenceVersionId),
    );
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.workflowInstance.findFirst({
        where: {
          id: instance.id,
          rowVersion: input.workflowVersion,
          state: "READY_FOR_RECOMMENDATION",
          active: true,
        },
      });
      if (!fresh)
        throw new ConflictException(
          "The Workflow was updated by another actor.",
        );
      await tx.workflowTask.updateMany({
        where: {
          workflowInstanceId: fresh.id,
          taskType: "CREATE_RECOMMENDATION",
          status: { in: ["PENDING", "CLAIMED"] },
        },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      const recommendation = await tx.decisionRecommendation.create({
        data: {
          workflowInstanceId: fresh.id,
          validationRunId: validation.id,
          cycleNumber: fresh.cycleNumber,
          actorId: identity.userId,
          outcome: input.outcome,
          reasonCodes: input.reasonCodes,
          rationale: input.rationale,
          conditions: input.conditions,
          evidenceSnapshot: evidence as unknown as Prisma.InputJsonValue,
          supportingAssessmentIds: input.supportingAssessmentIds,
          aggregateVersion: fresh.rowVersion + 1,
        },
      });
      await tx.decisionRecommendationEvidence.createMany({
        data: this.evidenceSnapshotRows(
          fresh.id,
          evidence,
          "decisionRecommendationId",
          recommendation.id,
        ),
      });
      await tx.workflowActionActor.create({
        data: {
          workflowInstanceId: fresh.id,
          action: "RECOMMENDATION_SUBMITTED",
          actorId: identity.userId,
          referenceId: recommendation.id,
        },
      });
      if (input.outcome === "REQUEST_MORE_INFORMATION") {
        const task = await tx.workflowTask.create({
          data: {
            organizationId: identity.organizationId,
            workflowInstanceId: fresh.id,
            caseId,
            taskType: "CORRECT_SUBMISSION",
            requiredPermission: "evidence:upload",
            eligibleRoleCodes: ["analyst"],
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        const updated = await tx.workflowInstance.update({
          where: { id: fresh.id },
          data: {
            state: "CORRECTION_REQUESTED",
            currentRecommendationId: recommendation.id,
            activeTaskId: task.id,
            rowVersion: { increment: 1 },
          },
        });
        return { recommendation, workflow: this.serialize(updated), task };
      }
      const task = await tx.workflowTask.create({
        data: {
          organizationId: identity.organizationId,
          workflowInstanceId: fresh.id,
          caseId,
          taskType: "APPROVE_DECISION",
          requiredPermission: "decision:approve",
          eligibleRoleCodes: ["approver"],
          dueAt: new Date(
            Date.now() +
              this.environment.WORKFLOW_DECISION_DEFAULT_DUE_HOURS *
                60 *
                60 *
                1000,
          ),
        },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: fresh.id },
        data: {
          state: "DECISION_PENDING",
          currentRecommendationId: recommendation.id,
          activeTaskId: task.id,
          caseSyncStatus: "PENDING",
          rowVersion: { increment: 1 },
        },
      });
      await this.transitionRecord(
        tx,
        fresh,
        updated,
        "SUBMIT_RECOMMENDATION",
        identity,
        correlationId,
      );
      await this.event(
        tx,
        updated,
        identity,
        correlationId,
        "decision.recommendation.recorded",
        {
          caseId,
          recommendationId: recommendation.id,
          outcome: recommendation.outcome,
        },
      );
      await this.queueSync(
        tx,
        updated,
        "DECISION_PENDING",
        "workflow.recommendation.case-sync",
      );
      return {
        recommendation: this.serialize(recommendation),
        workflow: this.serialize(updated),
        task,
      };
    });
  }

  async recommendations(caseId: string, identity: WorkflowIdentity) {
    const instances = await this.prisma.workflowInstance.findMany({
      where: { organizationId: identity.organizationId, caseId },
      select: { id: true },
    });
    return this.prisma.decisionRecommendation.findMany({
      where: { workflowInstanceId: { in: instances.map((item) => item.id) } },
      orderBy: { submittedAt: "desc" },
    });
  }

  async decide(
    caseId: string,
    outcome: "APPROVED" | "REJECTED",
    input: z.infer<typeof decisionSchema>,
    identity: WorkflowIdentity,
    correlationId: string,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey)
      throw new BadRequestException("Idempotency-Key is required.");
    const route = `cases/${caseId}/decision/${outcome.toLowerCase()}`;
    const requestHash = hash(input);
    const prior = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_actorId_route_key: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key: idempotencyKey,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ConflictException(
          "Idempotency key was used for a different request.",
        );
      return prior.responseBody;
    }
    const instance = await this.activeInstance(caseId, identity.organizationId);
    if (
      instance.state !== "DECISION_PENDING" ||
      instance.rowVersion !== input.workflowVersion ||
      !instance.currentRecommendationId ||
      !instance.activeTaskId
    )
      throw new ConflictException("The Workflow is not ready for decision.");
    const requiredPermission =
      outcome === "APPROVED" ? "decision:approve" : "decision:reject";
    const eligibility = await this.identities.eligibility(
      identity.organizationId,
      identity.userId,
      requiredPermission,
      correlationId,
    );
    if (!eligibility.eligible)
      throw new ForbiddenException(
        "The current user is not eligible for final decision.",
      );
    const [recommendation, version, validation, task] = await Promise.all([
      this.prisma.decisionRecommendation.findUniqueOrThrow({
        where: { id: instance.currentRecommendationId },
      }),
      this.prisma.workflowDefinitionVersion.findUniqueOrThrow({
        where: { id: instance.workflowDefinitionVersionId },
      }),
      this.currentValidation(instance),
      this.prisma.workflowTask.findFirst({
        where: {
          id: instance.activeTaskId,
          organizationId: identity.organizationId,
          taskType: "APPROVE_DECISION",
          status: { in: ["PENDING", "CLAIMED"] },
        },
      }),
    ]);
    if (!task || task.rowVersion !== input.taskVersion)
      throw new ConflictException("The approval task is stale or unavailable.");
    if (
      task.assignedUserId &&
      task.assignedUserId !== identity.userId &&
      task.claimedBy !== identity.userId
    )
      throw new ForbiddenException(
        "The approval task belongs to another user.",
      );
    if (version.fourEyesEnabled && recommendation.actorId === identity.userId)
      throw new ConflictException(
        "FOUR_EYES_RECOMMENDATION_AUTHOR: a separate approver is required.",
      );
    const reviewer = await this.prisma.workflowActionActor.findFirst({
      where: { workflowInstanceId: instance.id, action: "REVIEW_SUBMITTED" },
      orderBy: { occurredAt: "desc" },
    });
    if (
      version.prohibitReviewerApproval &&
      reviewer?.actorId === identity.userId
    )
      throw new ConflictException(
        "SEPARATION_OF_DUTIES_REVIEWER: the reviewer cannot decide.",
      );
    const pinned =
      validation.evidenceSnapshot as unknown as EvidenceSnapshotItem[];
    const current = await this.evidence.snapshot(
      identity.organizationId,
      caseId,
      correlationId,
    );
    this.assertSnapshotCurrent(
      pinned,
      current.items,
      pinned.map((item) => item.evidenceVersionId),
    );
    if (
      version.prohibitEvidenceSubmitterApproval &&
      pinned.some((item) => item.createdById === identity.userId)
    )
      throw new ConflictException(
        "SEPARATION_OF_DUTIES_EVIDENCE_SUBMITTER: the submitter cannot decide.",
      );
    const response = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.workflowInstance.findFirst({
        where: {
          id: instance.id,
          rowVersion: input.workflowVersion,
          state: "DECISION_PENDING",
          active: true,
        },
      });
      const freshTask = await tx.workflowTask.findFirst({
        where: {
          id: task.id,
          rowVersion: input.taskVersion,
          status: { in: ["PENDING", "CLAIMED"] },
        },
      });
      if (!fresh || !freshTask)
        throw new ConflictException(
          "The Workflow or approval task changed before commit.",
        );
      const superseded = await tx.decisionRecord.findFirst({
        where: {
          organizationId: identity.organizationId,
          caseId,
          workflowInstanceId: { not: fresh.id },
        },
        orderBy: { decidedAt: "desc" },
        select: { id: true },
      });
      const decision = await tx.decisionRecord.create({
        data: {
          organizationId: identity.organizationId,
          caseId,
          workflowInstanceId: fresh.id,
          cycleNumber: fresh.cycleNumber,
          recommendationId: recommendation.id,
          outcome,
          reasonCodes: input.reasonCodes,
          rationale: input.rationale,
          decidedBy: identity.userId,
          definitionVersionSnapshot: {
            id: version.id,
            versionNumber: version.versionNumber,
            configurationSha256: hash(version.configuration),
          },
          validationRunId: validation.id,
          evidenceSnapshot: pinned as unknown as Prisma.InputJsonValue,
          ...(superseded ? { supersedesDecisionId: superseded.id } : {}),
        },
      });
      await tx.decisionEvidenceSnapshot.createMany({
        data: this.evidenceSnapshotRows(
          fresh.id,
          pinned,
          "decisionRecordId",
          decision.id,
        ),
      });
      await tx.workflowActionActor.create({
        data: {
          workflowInstanceId: fresh.id,
          action: "DECISION_RECORDED",
          actorId: identity.userId,
          referenceId: decision.id,
        },
      });
      await tx.workflowTask.update({
        where: { id: freshTask.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: fresh.id },
        data: {
          state: outcome,
          active: false,
          currentDecisionId: decision.id,
          activeTaskId: null,
          completedAt: new Date(),
          caseSyncStatus: "PENDING",
          rowVersion: { increment: 1 },
        },
      });
      await this.transitionRecord(
        tx,
        fresh,
        updated,
        outcome === "APPROVED" ? "APPROVE" : "REJECT",
        identity,
        correlationId,
      );
      await this.event(
        tx,
        updated,
        identity,
        correlationId,
        "decision.final.recorded",
        { caseId, decisionId: decision.id, outcome },
      );
      await this.queueSync(
        tx,
        updated,
        "DECIDED",
        "workflow.decision.case-sync",
      );
      const result = {
        decision: this.serialize(decision),
        workflow: this.serialize(updated),
      };
      await tx.idempotencyRecord.create({
        data: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key: idempotencyKey,
          requestHash,
          responseStatus: 201,
          responseBody: result as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    });
    await this.attemptCaseSync(instance.id, correlationId);
    return response;
  }

  async decision(caseId: string, identity: WorkflowIdentity) {
    const decision = await this.prisma.decisionRecord.findFirst({
      where: { organizationId: identity.organizationId, caseId },
      include: { recommendation: true },
      orderBy: { decidedAt: "desc" },
    });
    if (!decision) throw new NotFoundException("Decision not found.");
    return this.serialize(decision);
  }

  async decisions(caseId: string, identity: WorkflowIdentity) {
    await this.cases.snapshot(identity.organizationId, caseId, randomUUID());
    return this.prisma.decisionRecord.findMany({
      where: { organizationId: identity.organizationId, caseId },
      include: {
        recommendation: true,
        evidence: { orderBy: { snapshotAt: "asc" } },
      },
      orderBy: { decidedAt: "desc" },
    });
  }

  async decisionById(decisionId: string, identity: WorkflowIdentity) {
    const decision = await this.prisma.decisionRecord.findFirst({
      where: { id: decisionId, organizationId: identity.organizationId },
      include: {
        recommendation: true,
        evidence: { orderBy: { snapshotAt: "asc" } },
      },
    });
    if (!decision) throw new NotFoundException("Decision not found.");
    return this.serialize(decision);
  }

  async withdraw(
    caseId: string,
    input: z.infer<typeof versionCommandSchema> & { reason?: string },
    identity: WorkflowIdentity,
    correlationId: string,
  ) {
    const instance = await this.activeInstance(caseId, identity.organizationId);
    if (instance.rowVersion !== input.expectedVersion)
      throw new ConflictException("The Workflow was updated by another actor.");
    return this.prisma.$transaction(async (tx) => {
      await tx.workflowTask.updateMany({
        where: {
          workflowInstanceId: instance.id,
          status: { in: ["PENDING", "CLAIMED"] },
        },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: {
          state: "WITHDRAWN",
          active: false,
          completedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.transitionRecord(
        tx,
        instance,
        updated,
        "WITHDRAW",
        identity,
        correlationId,
        input.reason,
      );
      return this.serialize(updated);
    });
  }

  async reopen(
    caseId: string,
    input: z.infer<typeof startSchema> & { reason: string },
    identity: WorkflowIdentity,
    correlationId: string,
    idempotencyKey: string,
  ) {
    const prior = await this.prisma.workflowInstance.findFirst({
      where: {
        organizationId: identity.organizationId,
        caseId,
        active: false,
        state: { in: ["APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED"] },
      },
      orderBy: { cycleNumber: "desc" },
    });
    if (!prior)
      throw new ConflictException(
        "No terminal Workflow is eligible to reopen.",
      );
    return this.start(
      caseId,
      {
        definitionVersionId:
          input.definitionVersionId ?? prior.workflowDefinitionVersionId,
      },
      identity,
      correlationId,
      idempotencyKey,
      {
        priorWorkflowInstanceId: prior.id,
        reason: input.reason,
      },
    );
  }

  async attemptCaseSync(instanceId: string, correlationId: string) {
    const operation = await this.prisma.caseSyncOperation.findFirst({
      where: {
        workflowInstanceId: instanceId,
        status: { in: ["PENDING", "FAILED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!operation) return;
    const instance = await this.prisma.workflowInstance.findUniqueOrThrow({
      where: { id: instanceId },
    });
    try {
      await this.cases.sync(
        {
          organizationId: operation.organizationId,
          caseId: operation.caseId,
          operationId: operation.id,
          workflowInstanceId: instance.id,
          targetStatus: operation.targetStatus,
          eventType: operation.eventType,
          reason: `Workflow ${instance.state}.`,
          actorId: instance.startedById,
        },
        correlationId,
      );
      await this.prisma.$transaction([
        this.prisma.caseSyncOperation.update({
          where: { id: operation.id },
          data: {
            status: "SYNCED",
            attempts: { increment: 1 },
            completedAt: new Date(),
            lastErrorCode: null,
          },
        }),
        this.prisma.workflowInstance.update({
          where: { id: instance.id },
          data: { caseSyncStatus: "SYNCED" },
        }),
      ]);
    } catch {
      const attempts = operation.attempts + 1;
      await this.prisma.$transaction([
        this.prisma.caseSyncOperation.update({
          where: { id: operation.id },
          data: {
            status:
              attempts >= this.environment.WORKFLOW_CASE_SYNC_MAX_ATTEMPTS
                ? "FAILED"
                : "PENDING",
            attempts,
            lastErrorCode: "CASE_SYNC_UNAVAILABLE",
            nextAttemptAt: new Date(
              Date.now() +
                this.environment.WORKFLOW_CASE_SYNC_RETRY_BASE_MS *
                  2 ** Math.min(attempts, 6),
            ),
          },
        }),
        this.prisma.workflowInstance.update({
          where: { id: instance.id },
          data: { caseSyncStatus: "FAILED" },
        }),
      ]);
    }
  }

  private async assertOwnedDefinition(id: string, identity: WorkflowIdentity) {
    const found = await this.prisma.workflowDefinition.findFirst({
      where: { id, organizationId: identity.organizationId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Workflow definition not found.");
  }

  private async activeInstance(caseId: string, organizationId: string) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { caseId, organizationId, active: true },
    });
    if (!instance) throw new NotFoundException("Active Workflow not found.");
    return instance;
  }

  private async instanceById(id: string, organizationId: string) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id, organizationId },
    });
    if (!instance) throw new NotFoundException("Workflow not found.");
    return instance;
  }

  private async taskRow(id: string, organizationId: string) {
    const task = await this.prisma.workflowTask.findFirst({
      where: { id, organizationId },
    });
    if (!task) throw new NotFoundException("Workflow task not found.");
    return task;
  }

  private async currentValidation(instance: WorkflowInstance) {
    if (!instance.currentValidationRunId)
      throw new ConflictException("No current Validation Run exists.");
    const validation = await this.prisma.validationRun.findUnique({
      where: { id: instance.currentValidationRunId },
      include: { results: true },
    });
    if (!validation || validation.status !== "PASS")
      throw new ConflictException(
        "A passing current Validation Run is required.",
      );
    return validation;
  }

  private assertSnapshotCurrent(
    pinned: EvidenceSnapshotItem[],
    current: EvidenceSnapshotItem[],
    selected: string[],
  ) {
    const pinnedById = new Map(
      pinned.map((item) => [item.evidenceVersionId, item]),
    );
    const currentById = new Map(
      current.map((item) => [item.evidenceVersionId, item]),
    );
    for (const id of selected) {
      const before = pinnedById.get(id);
      const now = currentById.get(id);
      if (
        !before ||
        !now ||
        before.sha256 !== now.sha256 ||
        now.processingStatus !== "AVAILABLE" ||
        now.malwareStatus !== "CLEAN" ||
        !now.authoritative
      )
        throw new ConflictException(
          "The Evidence snapshot changed; revalidation is required.",
        );
    }
  }

  private evidenceSnapshotRows<
    K extends
      "reviewSubmissionId" | "decisionRecommendationId" | "decisionRecordId",
  >(
    workflowInstanceId: string,
    evidence: EvidenceSnapshotItem[],
    foreignKey: K,
    foreignId: string,
  ): Array<
    {
      workflowInstanceId: string;
      evidenceAssetId: string;
      evidenceVersionId: string;
      sha256: string;
      classificationCode: string;
      evidenceStatus: string;
      availableAt: Date;
    } & Record<K, string>
  > {
    return evidence.map((item) => ({
      workflowInstanceId,
      evidenceAssetId: item.evidenceAssetId,
      evidenceVersionId: item.evidenceVersionId,
      sha256: item.sha256,
      classificationCode: item.classificationCode,
      evidenceStatus: item.evidenceStatus,
      availableAt: new Date(item.availableAt),
      [foreignKey]: foreignId,
    })) as Array<
      {
        workflowInstanceId: string;
        evidenceAssetId: string;
        evidenceVersionId: string;
        sha256: string;
        classificationCode: string;
        evidenceStatus: string;
        availableAt: Date;
      } & Record<K, string>
    >;
  }

  private async transitionRecord(
    tx: Prisma.TransactionClient,
    previous: WorkflowInstance,
    updated: WorkflowInstance,
    action: string,
    identity: WorkflowIdentity,
    correlationId: string,
    reasonCode?: string,
  ) {
    await tx.workflowStateHistory.create({
      data: {
        workflowInstanceId: previous.id,
        fromState: previous.state,
        toState: updated.state,
        action,
        ...(reasonCode ? { reasonCode: reasonCode.slice(0, 80) } : {}),
        actorType: "USER",
        actorId: identity.userId,
        aggregateVersion: updated.rowVersion,
        correlationId,
      },
    });
  }

  private async event(
    tx: Prisma.TransactionClient,
    instance: WorkflowInstance,
    identity: WorkflowIdentity,
    correlationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    await tx.outboxEvent.create({
      data: {
        aggregateType: "WorkflowInstance",
        aggregateId: instance.id,
        aggregateVersion: instance.rowVersion,
        eventType,
        eventVersion: "1.0",
        payload: payload as Prisma.InputJsonValue,
        correlationId,
        organizationId: identity.organizationId,
        actorType: "USER",
        actorId: identity.userId,
      },
    });
  }

  private async queueSync(
    tx: Prisma.TransactionClient,
    instance: WorkflowInstance,
    targetStatus: string,
    eventType: string,
  ) {
    await tx.caseSyncOperation.upsert({
      where: {
        workflowInstanceId_eventType: {
          workflowInstanceId: instance.id,
          eventType,
        },
      },
      update: { status: "PENDING", nextAttemptAt: new Date() },
      create: {
        workflowInstanceId: instance.id,
        organizationId: instance.organizationId,
        caseId: instance.caseId,
        targetStatus,
        eventType,
      },
    });
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => {
        if (item instanceof Date) return item.toISOString();
        if (typeof item === "bigint") return item.toString();
        return item;
      }),
    ) as T;
  }
}
