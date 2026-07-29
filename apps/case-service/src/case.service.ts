import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  CasePriority,
  CaseStatus,
  CreateCaseRequest,
  UpdateCaseRequest,
} from "@cdep/contracts";
import { PrismaService } from "./prisma.service.js";

type Identity = { userId: string; organizationId: string };

@Injectable()
export class CaseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateCaseRequest,
    identity: Identity,
    correlationId: string,
    key?: string,
  ) {
    const requestHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return this.prisma.$transaction(async (tx) => {
      if (key) {
        const prior = await tx.idempotencyRecord.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: identity.organizationId,
              idempotencyKey: key,
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
      }
      const sequence = await tx.$queryRaw<
        Array<{ value: bigint }>
      >`SELECT nextval('case_number_seq') AS value`;
      const value = sequence[0]?.value;
      if (value === undefined)
        throw new Error("Case number allocation failed.");
      const caseNumber = `DC-${new Date().getUTCFullYear()}-${value.toString().padStart(6, "0")}`;
      const created = await tx.decisionCase.create({
        data: {
          organizationId: identity.organizationId,
          caseNumber,
          caseType: input.caseType,
          title: input.title,
          priority: input.priority,
          ...(input.externalReference !== undefined
            ? { externalReference: input.externalReference }
            : {}),
          ...(input.requestedAmountMinor !== undefined
            ? { requestedAmountMinor: input.requestedAmountMinor }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.decisionDueAt !== undefined
            ? { decisionDueAt: new Date(input.decisionDueAt) }
            : {}),
          createdBy: identity.userId,
          updatedBy: identity.userId,
          statusHistory: {
            create: {
              toStatus: "DRAFT",
              changedBy: identity.userId,
              version: 1,
            },
          },
        },
      });
      await this.event(tx, created, identity, correlationId, "case.created", {
        caseNumber,
      });
      const response = this.serialize(created);
      if (key)
        await tx.idempotencyRecord.create({
          data: {
            organizationId: identity.organizationId,
            idempotencyKey: key,
            requestHash,
            responseStatus: 201,
            responseBody: response,
          },
        });
      return response;
    });
  }

  async list(identity: Identity, query: Record<string, string | undefined>) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where = {
      organizationId: identity.organizationId,
      ...(query.status ? { status: query.status as CaseStatus } : {}),
      ...(query.priority ? { priority: query.priority as CasePriority } : {}),
      ...(query.search
        ? {
            OR: [
              {
                caseNumber: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              {
                title: { contains: query.search, mode: "insensitive" as const },
              },
              {
                externalReference: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.decisionCase.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.decisionCase.count({ where }),
    ]);
    return {
      items: items.map((x) => this.serialize(x)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(id: string, identity: Identity) {
    const item = await this.prisma.decisionCase.findFirst({
      where: { id, organizationId: identity.organizationId },
      include: { parties: true, assignments: true },
    });
    if (!item) throw new NotFoundException("Case not found.");
    return this.serialize(item);
  }

  async update(
    id: string,
    input: UpdateCaseRequest,
    identity: Identity,
    correlationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.decisionCase.findFirst({
        where: { id, organizationId: identity.organizationId },
      });
      if (!current) throw new NotFoundException("Case not found.");
      if (current.version !== input.version)
        throw new ConflictException("The case was updated by another user.");
      if (
        input.status &&
        !(current.status === "DRAFT" && input.status === "OPEN") &&
        input.status !== current.status
      )
        throw new UnprocessableEntityException(
          "This status transition is workflow-owned or invalid.",
        );
      const nextVersion = current.version + 1;
      const updateData = {
        ...input,
        version: nextVersion,
        updatedBy: identity.userId,
        decisionDueAt:
          input.decisionDueAt === null
            ? null
            : input.decisionDueAt
              ? new Date(input.decisionDueAt)
              : undefined,
        openedAt:
          current.status === "DRAFT" && input.status === "OPEN"
            ? new Date()
            : undefined,
      };
      for (const key of Object.keys(updateData) as Array<
        keyof typeof updateData
      >) {
        if (updateData[key] === undefined) delete updateData[key];
      }
      const written = await tx.decisionCase.updateMany({
        where: {
          id,
          organizationId: identity.organizationId,
          version: input.version,
        },
        data: updateData as never,
      });
      if (written.count !== 1) {
        throw new ConflictException("The case was updated by another user.");
      }
      const updated = await tx.decisionCase.findUniqueOrThrow({
        where: { id },
      });
      if (updated.status !== current.status) {
        await tx.caseStatusHistory.create({
          data: {
            caseId: id,
            fromStatus: current.status,
            toStatus: updated.status,
            changedBy: identity.userId,
            version: nextVersion,
          },
        });
        await this.event(
          tx,
          updated,
          identity,
          correlationId,
          "case.status.changed",
          { fromStatus: current.status, toStatus: updated.status },
        );
      } else
        await this.event(
          tx,
          updated,
          identity,
          correlationId,
          "case.updated",
          {},
        );
      return this.serialize(updated);
    });
  }

  async addParty(
    id: string,
    input: {
      partyType: string;
      displayName: string;
      externalReference?: string;
    },
    identity: Identity,
    correlationId: string,
  ) {
    await this.assertCase(id, identity);
    return this.prisma.$transaction(async (tx) => {
      const party = await tx.caseParty.create({
        data: {
          caseId: id,
          partyType: input.partyType as never,
          displayName: input.displayName,
          ...(input.externalReference !== undefined
            ? { externalReference: input.externalReference }
            : {}),
          createdBy: identity.userId,
        },
      });
      const updated = await tx.decisionCase.update({
        where: { id },
        data: { version: { increment: 1 }, updatedBy: identity.userId },
      });
      await this.event(tx, updated, identity, correlationId, "case.updated", {
        change: "party.added",
        partyId: party.id,
      });
      return { ...party, createdAt: party.createdAt.toISOString() };
    });
  }

  async addAssignment(
    id: string,
    input: { userId: string; role: string },
    identity: Identity,
    correlationId: string,
  ) {
    await this.assertCase(id, identity);
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.caseAssignment.create({
        data: {
          caseId: id,
          userId: input.userId,
          role: input.role as never,
          createdBy: identity.userId,
        },
      });
      const updated = await tx.decisionCase.update({
        where: { id },
        data: { version: { increment: 1 }, updatedBy: identity.userId },
      });
      await this.event(
        tx,
        updated,
        identity,
        correlationId,
        "case.assignment.changed",
        {
          action: "ADDED",
          assignmentId: assignment.id,
          userId: input.userId,
          role: input.role,
        },
      );
      return { ...assignment, createdAt: assignment.createdAt.toISOString() };
    });
  }

  async removeAssignment(
    id: string,
    assignmentId: string,
    identity: Identity,
    correlationId: string,
  ) {
    await this.assertCase(id, identity);
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.caseAssignment.findFirst({
        where: { id: assignmentId, caseId: id },
      });
      if (!assignment) throw new NotFoundException("Assignment not found.");
      await tx.caseAssignment.delete({ where: { id: assignmentId } });
      const updated = await tx.decisionCase.update({
        where: { id },
        data: { version: { increment: 1 }, updatedBy: identity.userId },
      });
      await this.event(
        tx,
        updated,
        identity,
        correlationId,
        "case.assignment.changed",
        { action: "REMOVED", assignmentId },
      );
    });
  }

  async timeline(id: string, identity: Identity) {
    await this.assertCase(id, identity);
    const rows = await this.prisma.caseStatusHistory.findMany({
      where: { caseId: id },
      orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    });
    return rows.map((x) => ({ ...x, changedAt: x.changedAt.toISOString() }));
  }

  async addExternalReference(
    id: string,
    input: {
      sourceSystemId: string;
      referenceType: string;
      referenceValue: string;
      isPrimary: boolean;
    },
    identity: Identity,
  ) {
    await this.assertCase(id, identity);
    const created = await this.prisma.caseExternalReference.create({
      data: {
        ...input,
        caseId: id,
        organizationId: identity.organizationId,
        createdBy: identity.userId,
      },
    });
    return { ...created, createdAt: created.createdAt.toISOString() };
  }
  async listExternalReferences(id: string, identity: Identity) {
    await this.assertCase(id, identity);
    const rows = await this.prisma.caseExternalReference.findMany({
      where: { caseId: id, organizationId: identity.organizationId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return rows.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() }));
  }
  async removeExternalReference(
    id: string,
    referenceId: string,
    identity: Identity,
  ) {
    await this.assertCase(id, identity);
    const found = await this.prisma.caseExternalReference.findFirst({
      where: {
        id: referenceId,
        caseId: id,
        organizationId: identity.organizationId,
      },
    });
    if (!found) throw new NotFoundException("External reference not found.");
    await this.prisma.caseExternalReference.delete({
      where: { id: referenceId },
    });
  }
  async resolveExternalReference(input: {
    organizationId: string;
    sourceSystemId: string;
    referenceType: string;
    referenceValue: string;
  }) {
    const found = await this.prisma.caseExternalReference.findUnique({
      where: {
        organizationId_sourceSystemId_referenceType_referenceValue: input,
      },
      include: { decisionCase: { select: { caseNumber: true, status: true } } },
    });
    if (!found) throw new NotFoundException("External reference not found.");
    return {
      caseId: found.caseId,
      organizationId: found.organizationId,
      caseNumber: found.decisionCase.caseNumber,
      status: found.decisionCase.status,
    };
  }

  async resolveCorrelation(input: {
    organizationId: string;
    sourceSystemId: string;
    ruleType: string;
    referenceType?: string;
    referenceValue: string;
  }) {
    if (input.ruleType === "BUSINESS_REFERENCE_EQUALS") {
      const rows = await this.prisma.decisionCase.findMany({
        where: {
          organizationId: input.organizationId,
          externalReference: input.referenceValue,
        },
        select: { id: true, caseNumber: true, status: true },
        take: 2,
      });
      return {
        matches: rows.map((row) => ({
          caseId: row.id,
          caseNumber: row.caseNumber,
          status: row.status,
        })),
      };
    }
    if (input.ruleType === "EXTERNAL_REFERENCE_EQUALS" && input.referenceType) {
      const rows = await this.prisma.caseExternalReference.findMany({
        where: {
          organizationId: input.organizationId,
          sourceSystemId: input.sourceSystemId,
          referenceType: input.referenceType,
          referenceValue: input.referenceValue,
        },
        include: {
          decisionCase: { select: { caseNumber: true, status: true } },
        },
        take: 2,
      });
      return {
        matches: rows.map((row) => ({
          caseId: row.caseId,
          caseNumber: row.decisionCase.caseNumber,
          status: row.decisionCase.status,
        })),
      };
    }
    return { matches: [] };
  }

  async internalAccessCheck(organizationId: string, caseId: string) {
    const item = await this.prisma.decisionCase.findFirst({
      where: { id: caseId, organizationId },
      select: {
        id: true,
        caseNumber: true,
        title: true,
        caseType: true,
        status: true,
        priority: true,
        requestedAmountMinor: true,
        currency: true,
        decisionDueAt: true,
        version: true,
      },
    });
    if (!item) throw new NotFoundException("Case not found.");
    return {
      ...item,
      decisionDueAt: item.decisionDueAt?.toISOString() ?? null,
    };
  }

  async internalWorkflowSync(input: {
    organizationId: string;
    caseId: string;
    operationId: string;
    workflowInstanceId: string;
    targetStatus: CaseStatus;
    eventType: string;
    reason?: string;
    actorId: string;
    correlationId?: string;
  }) {
    const allowed = new Set<CaseStatus>([
      "EVIDENCE_COLLECTION",
      "UNDER_REVIEW",
      "DECISION_PENDING",
      "DECIDED",
    ]);
    if (!allowed.has(input.targetStatus))
      throw new UnprocessableEntityException(
        "Unsupported Workflow Case status.",
      );
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.inboxEvent.findUnique({
        where: { eventId: input.operationId },
      });
      if (prior) {
        const current = await tx.decisionCase.findFirst({
          where: {
            id: input.caseId,
            organizationId: input.organizationId,
          },
        });
        if (!current) throw new NotFoundException("Case not found.");
        return { applied: false, case: this.serialize(current) };
      }
      const current = await tx.decisionCase.findFirst({
        where: { id: input.caseId, organizationId: input.organizationId },
      });
      if (!current) throw new NotFoundException("Case not found.");
      if (
        current.status === "CANCELLED" ||
        current.status === "CLOSED" ||
        (current.status === "DECIDED" && input.targetStatus !== "DECIDED")
      )
        throw new ConflictException(
          "The Case state no longer permits Workflow synchronization.",
        );
      const nextVersion = current.version + 1;
      const updated =
        current.status === input.targetStatus
          ? current
          : await tx.decisionCase.update({
              where: { id: current.id },
              data: {
                status: input.targetStatus,
                version: nextVersion,
                updatedBy: input.actorId,
              },
            });
      if (current.status !== input.targetStatus)
        await tx.caseStatusHistory.create({
          data: {
            caseId: current.id,
            fromStatus: current.status,
            toStatus: input.targetStatus,
            reason:
              input.reason ??
              `Workflow ${input.workflowInstanceId} synchronization.`,
            changedBy: input.actorId,
            version: nextVersion,
          },
        });
      await tx.inboxEvent.create({
        data: { eventId: input.operationId, eventType: input.eventType },
      });
      return { applied: true, case: this.serialize(updated) };
    });
  }

  async evidenceProjection(id: string, identity: Identity) {
    await this.assertCase(id, identity);
    const [items, timeline] = await Promise.all([
      this.prisma.caseEvidenceProjection.findMany({
        where: { caseId: id, organizationId: identity.organizationId },
        orderBy: [{ occurredAt: "desc" }, { evidenceAssetId: "asc" }],
      }),
      this.prisma.caseEvidenceTimelineEvent.findMany({
        where: { caseId: id, organizationId: identity.organizationId },
        orderBy: [{ occurredAt: "desc" }, { eventId: "asc" }],
      }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        occurredAt: item.occurredAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      timeline: timeline.map((item) => ({
        ...item,
        occurredAt: item.occurredAt.toISOString(),
      })),
    };
  }

  async cancel(
    id: string,
    version: number,
    reason: string,
    identity: Identity,
    correlationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.decisionCase.findFirst({
        where: { id, organizationId: identity.organizationId },
      });
      if (!current) throw new NotFoundException("Case not found.");
      if (current.version !== version) {
        throw new ConflictException("The case was updated by another user.");
      }
      if (
        current.status === "CANCELLED" ||
        current.status === "CLOSED" ||
        current.status === "DECIDED"
      ) {
        throw new UnprocessableEntityException("The case cannot be cancelled.");
      }
      const written = await tx.decisionCase.updateMany({
        where: {
          id,
          organizationId: identity.organizationId,
          version,
        },
        data: {
          status: "CANCELLED",
          closedAt: new Date(),
          version: { increment: 1 },
          updatedBy: identity.userId,
        },
      });
      if (written.count !== 1) {
        throw new ConflictException("The case was updated by another user.");
      }
      const updated = await tx.decisionCase.findUniqueOrThrow({
        where: { id },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId: id,
          fromStatus: current.status,
          toStatus: "CANCELLED",
          reason,
          changedBy: identity.userId,
          version: updated.version,
        },
      });
      await this.event(tx, updated, identity, correlationId, "case.cancelled", {
        reason,
      });
      return this.serialize(updated);
    });
  }

  private async assertCase(id: string, identity: Identity) {
    const found = await this.prisma.decisionCase.findFirst({
      where: { id, organizationId: identity.organizationId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Case not found.");
  }
  private async event(
    tx: any,
    item: any,
    identity: Identity,
    correlationId: string,
    eventType: string,
    payload: object,
  ) {
    await tx.outboxEvent.create({
      data: {
        aggregateType: "DecisionCase",
        aggregateId: item.id,
        aggregateVersion: item.version,
        eventType,
        eventVersion: "1.0",
        payload,
        correlationId,
        organizationId: identity.organizationId,
        actorId: identity.userId,
      },
    });
  }
  private serialize(item: any): any {
    const date = (value: Date | null | undefined) =>
      value ? value.toISOString() : null;
    return {
      ...item,
      openedAt: date(item.openedAt),
      decisionDueAt: date(item.decisionDueAt),
      closedAt: date(item.closedAt),
      createdAt: date(item.createdAt),
      updatedAt: date(item.updatedAt),
      parties: item.parties?.map((x: any) => ({
        ...x,
        createdAt: date(x.createdAt),
      })),
      assignments: item.assignments?.map((x: any) => ({
        ...x,
        createdAt: date(x.createdAt),
      })),
    };
  }
}
