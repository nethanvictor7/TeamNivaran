import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@cdep/audit-prisma-client";
import {
  auditExportRequestSchema,
  auditOperationRequestSchema,
  auditReportRequestSchema,
  auditSearchQuerySchema,
  type AuditSearchQuery,
} from "@cdep/contracts";
import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  auditRecordHash,
  canonicalJson,
  csvRow,
  decodeCursor,
  encodeCursor,
  sha256,
} from "./audit-crypto.js";
import type { AuditIdentity } from "./authentication.js";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";
import { ArtifactStorage } from "./storage.service.js";

export const auditSearchSchema = auditSearchQuerySchema;
export type AuditSearch = AuditSearchQuery;

const reportDefinitions = [
  {
    key: "CASE_DECISION_DOSSIER",
    version: "1.0",
    title: "Case decision dossier",
    description:
      "A complete timeline of case, evidence, review, decision, AI and ledger activity.",
    parameters: [{ key: "caseId", type: "uuid", required: true }],
  },
  {
    key: "EVIDENCE_VALIDATION_HISTORY",
    version: "1.0",
    title: "Evidence and validation history",
    description: "Evidence versions, security checks and validation activity.",
    parameters: [{ key: "caseId", type: "uuid", required: false }],
  },
  {
    key: "HUMAN_DECISION_SUMMARY",
    version: "1.0",
    title: "Human decision summary",
    description:
      "Human review, recommendation, approval, and rejection activity.",
    parameters: [{ key: "caseId", type: "uuid", required: false }],
  },
  {
    key: "LEDGER_VERIFICATION_HISTORY",
    version: "1.0",
    title: "Ledger proof and verification history",
    description:
      "Ledger proof requests, confirmations and verification checks.",
    parameters: [{ key: "caseId", type: "uuid", required: false }],
  },
  {
    key: "OPERATIONAL_AUDIT_ACTIVITY",
    version: "1.0",
    title: "Audit activity",
    description: "A point-in-time record of activity across the organisation.",
    parameters: [],
  },
  {
    key: "AI_ASSESSMENT_GOVERNANCE",
    version: "1.0",
    title: "AI assessment and governance",
    description:
      "AI assessment activity, policy settings and human review controls.",
    parameters: [{ key: "caseId", type: "uuid", required: false }],
  },
] as const;

function serializeRecord(record: {
  sourceOffset: bigint;
  [key: string]: unknown;
}) {
  return { ...record, sourceOffset: record.sourceOffset.toString() };
}

@Injectable()
export class AuditService {
  private readonly environment = getEnvironment();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArtifactStorage,
  ) {}

  private async appendControlRecord(
    transaction: Prisma.TransactionClient,
    input: {
      identity: AuditIdentity;
      eventType: string;
      resourceType: string;
      resourceId: string;
      outcome?: "SUCCESS" | "FAILURE" | "DENIED" | "PENDING";
      metadata?: Record<string, unknown>;
      correlationId?: string;
    },
  ) {
    const previous = await transaction.auditRecord.findFirst({
      where: { organizationId: input.identity.organizationId },
      orderBy: [{ ingestedAt: "desc" }, { id: "desc" }],
      select: { recordHash: true, occurredAt: true },
    });
    const id = randomUUID();
    const eventId = randomUUID();
    const occurredAt = new Date();
    const sourceOffset =
      BigInt(Date.now()) * 1_000_000n + BigInt(randomInt(0, 1_000_000));
    const metadata = input.metadata ?? {};
    const record = {
      id,
      eventId,
      organizationId: input.identity.organizationId,
      occurredAt: occurredAt.toISOString(),
      sourceService: "audit-query-service",
      eventType: input.eventType,
      schemaVersion: "1.0",
      actorType: "USER",
      actorId: input.identity.userId,
      correlationId: input.correlationId ?? randomUUID(),
      causationId: null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.eventType,
      outcome: input.outcome ?? ("SUCCESS" as const),
      classification: "CONFIDENTIAL",
      metadata,
      previousRecordHash: previous?.recordHash ?? null,
      sourceTopic: "cdep.audit.events.v1",
      sourcePartition: 0,
      sourceOffset: sourceOffset.toString(),
      projectionVersion: 1,
      lateArrival: Boolean(previous && occurredAt < previous.occurredAt),
    };
    await transaction.auditRecord.create({
      data: {
        ...record,
        occurredAt,
        metadata: metadata as Prisma.InputJsonValue,
        sourceOffset,
        recordHash: auditRecordHash(record),
      },
    });
  }

  reportCatalog() {
    return { items: reportDefinitions };
  }

  private filtersHash(
    organizationId: string,
    search: Omit<AuditSearch, "cursor">,
  ) {
    return sha256(canonicalJson({ organizationId, ...search }));
  }

  private where(
    organizationId: string,
    input: Omit<AuditSearch, "cursor" | "pageSize">,
    snapshotBoundary?: Date,
  ): Prisma.AuditRecordWhereInput {
    const occurredAt: Prisma.DateTimeFilter = {};
    if (input.from) occurredAt.gte = new Date(input.from);
    if (input.to) occurredAt.lte = new Date(input.to);
    if (snapshotBoundary) occurredAt.lte = snapshotBoundary;
    const where: Prisma.AuditRecordWhereInput = {
      organizationId,
      ...(Object.keys(occurredAt).length ? { occurredAt } : {}),
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...(input.sourceService ? { sourceService: input.sourceService } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.classification ? { classification: input.classification } : {}),
      ...(input.resourceType ? { resourceType: input.resourceType } : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };
    if (input.search)
      where.OR = [
        { eventType: { contains: input.search, mode: "insensitive" } },
        { sourceService: { contains: input.search, mode: "insensitive" } },
        { resourceId: { contains: input.search, mode: "insensitive" } },
        { actorId: { contains: input.search, mode: "insensitive" } },
      ];
    return where;
  }

  async search(identity: AuditIdentity, raw: unknown) {
    const input = auditSearchSchema.parse(raw);
    const { cursor, pageSize, ...filters } = input;
    const filterHash = this.filtersHash(identity.organizationId, {
      ...filters,
      pageSize,
    });
    let cursorBoundary: { occurredAt: Date; id: string } | undefined =
      undefined;
    if (cursor) {
      try {
        const decoded = decodeCursor(
          cursor,
          {
            organizationId: identity.organizationId,
            filtersHash: filterHash,
          },
          this.environment.CURSOR_SIGNING_SECRET,
        );
        cursorBoundary = {
          occurredAt: new Date(decoded.occurredAt),
          id: decoded.id,
        };
      } catch {
        throw new BadRequestException(
          "The audit cursor is invalid, expired, or does not match these filters.",
        );
      }
    }
    const where = this.where(identity.organizationId, filters);
    if (cursorBoundary) {
      const descending = filters.sort === "OCCURRED_DESC";
      const boundary: Prisma.AuditRecordWhereInput = {
        OR: [
          {
            occurredAt: {
              [descending ? "lt" : "gt"]: cursorBoundary.occurredAt,
            },
          },
          {
            occurredAt: cursorBoundary.occurredAt,
            id: { [descending ? "lt" : "gt"]: cursorBoundary.id },
          },
        ],
      };
      where.AND = [boundary];
    }
    const direction = filters.sort === "OCCURRED_DESC" ? "desc" : "asc";
    const rows = await this.prisma.auditRecord.findMany({
      where,
      orderBy: [{ occurredAt: direction }, { id: direction }],
      take: pageSize + 1,
    });
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      items: page.map(serializeRecord),
      nextCursor:
        rows.length > pageSize && last
          ? encodeCursor(
              {
                organizationId: identity.organizationId,
                filtersHash: filterHash,
                occurredAt: last.occurredAt.toISOString(),
                id: last.id,
              },
              this.environment.CURSOR_SIGNING_SECRET,
            )
          : null,
      snapshotBoundary: new Date().toISOString(),
      freshness: await this.freshness(),
    };
  }

  async detail(identity: AuditIdentity, id: string) {
    const row = await this.prisma.auditRecord.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!row) throw new NotFoundException("Audit record not found.");
    return serializeRecord(row);
  }

  async journey(identity: AuditIdentity, caseId: string) {
    const candidates = await this.prisma.auditRecord.findMany({
      where: {
        organizationId: identity.organizationId,
        OR: [
          { resourceId: caseId },
          { metadata: { path: ["caseId"], equals: caseId } },
          { metadata: { path: ["case", "id"], equals: caseId } },
        ],
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 1000,
    });
    return {
      caseId,
      items: candidates.map((row) => ({
        ...serializeRecord(row),
        category: this.category(row.eventType),
        summary: row.eventType.replaceAll(".", " "),
      })),
      complete: candidates.length < 1000,
      freshness: await this.freshness(),
    };
  }

  private category(eventType: string) {
    if (/evidence/i.test(eventType)) return "EVIDENCE";
    if (/validation|workflow|review/i.test(eventType)) return "VALIDATION";
    if (/decision/i.test(eventType)) return "DECISION";
    if (/assessment|governance/i.test(eventType)) return "AI";
    if (/proof|ledger|verification/i.test(eventType)) return "LEDGER";
    if (/report|export/i.test(eventType)) return "REPORTING";
    return "CASE";
  }

  async verifyChain(identity: AuditIdentity, limit = 500) {
    const rows = await this.prisma.auditRecord.findMany({
      where: { organizationId: identity.organizationId },
      orderBy: [{ ingestedAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 5000),
    });
    let previous: string | null = null;
    for (const row of rows) {
      const material = {
        id: row.id,
        eventId: row.eventId,
        organizationId: row.organizationId,
        occurredAt: row.occurredAt.toISOString(),
        sourceService: row.sourceService,
        eventType: row.eventType,
        schemaVersion: row.schemaVersion,
        actorType: row.actorType,
        actorId: row.actorId,
        correlationId: row.correlationId,
        causationId: row.causationId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        action: row.action,
        outcome: row.outcome,
        classification: row.classification,
        metadata: row.metadata,
        previousRecordHash: row.previousRecordHash,
        sourceTopic: row.sourceTopic,
        sourcePartition: row.sourcePartition,
        sourceOffset: row.sourceOffset.toString(),
        projectionVersion: row.projectionVersion,
        lateArrival: row.lateArrival,
      };
      if (
        row.previousRecordHash !== previous ||
        auditRecordHash(material) !== row.recordHash
      )
        return {
          status: "FAILED",
          checked: rows.indexOf(row),
          failureAt: row.id,
        };
      previous = row.recordHash;
    }
    return {
      status: "VERIFIED",
      checked: rows.length,
      firstRecordId: rows[0]?.id ?? null,
      lastRecordId: rows.at(-1)?.id ?? null,
      verifiedAt: new Date().toISOString(),
    };
  }

  async createReport(
    identity: AuditIdentity,
    raw: unknown,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const input = auditReportRequestSchema.parse(raw);
    if (!idempotencyKey)
      throw new BadRequestException("An idempotency-key header is required.");
    const requestHash = sha256(canonicalJson(input));
    const previous = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_key: {
          organizationId: identity.organizationId,
          key: idempotencyKey,
        },
      },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ConflictException(
          "The idempotency key was already used for another request.",
        );
      return this.prisma.reportRun.findFirst({
        where: {
          id: previous.resourceId,
          organizationId: identity.organizationId,
        },
      });
    }
    const definition = reportDefinitions.find(
      (item) => item.key === input.reportKey,
    )!;
    if (
      definition.parameters.some(
        (parameter) => parameter.required && !input.parameters[parameter.key],
      )
    )
      throw new BadRequestException("Required report parameters are missing.");
    return this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.reportRun.create({
          data: {
            organizationId: identity.organizationId,
            reportKey: definition.key,
            reportVersion: definition.version,
            parameters: input.parameters as Prisma.InputJsonValue,
            requestedBy: identity.userId,
            snapshotBoundary: new Date(),
            expiresAt: new Date(
              Date.now() +
                this.environment.ARTIFACT_RETENTION_HOURS * 3_600_000,
            ),
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            organizationId: identity.organizationId,
            key: idempotencyKey,
            requestHash,
            resourceType: "REPORT",
            resourceId: run.id,
          },
        });
        await this.appendControlRecord(transaction, {
          identity,
          eventType: "report.run.requested",
          resourceType: "ReportRun",
          resourceId: run.id,
          outcome: "PENDING",
          metadata: {
            reportKey: definition.key,
            reportVersion: definition.version,
            snapshotBoundary: run.snapshotBoundary.toISOString(),
          },
          correlationId,
        });
        return run;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async reports(identity: AuditIdentity) {
    return {
      items: await this.prisma.reportRun.findMany({
        where: { organizationId: identity.organizationId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    };
  }

  async report(identity: AuditIdentity, id: string) {
    const run = await this.prisma.reportRun.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!run) throw new NotFoundException("Report run not found.");
    return run;
  }

  async reportDownload(
    identity: AuditIdentity,
    id: string,
    correlationId: string,
  ) {
    const run = await this.report(identity, id);
    if (run.state !== "COMPLETED" || !run.artifactKey || !run.artifactFilename)
      throw new ConflictException("The report artifact is not available.");
    if (run.expiresAt <= new Date())
      throw new ConflictException("The report artifact has expired.");
    const grant = await this.storage.grant({
      key: run.artifactKey,
      filename: run.artifactFilename,
    });
    await this.prisma.$transaction(
      async (transaction) =>
        this.appendControlRecord(transaction, {
          identity,
          eventType: "report.artifact.download-granted",
          resourceType: "ReportRun",
          resourceId: run.id,
          metadata: {
            classification: run.classification,
            artifactMediaType: run.artifactMediaType,
          },
          correlationId,
        }),
      { isolationLevel: "Serializable" },
    );
    return grant;
  }

  async createExport(
    identity: AuditIdentity,
    raw: unknown,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const input = auditExportRequestSchema.parse(raw);
    if (!idempotencyKey)
      throw new BadRequestException("An idempotency-key header is required.");
    const requestHash = sha256(canonicalJson(input));
    const previous = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_key: {
          organizationId: identity.organizationId,
          key: idempotencyKey,
        },
      },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ConflictException(
          "The idempotency key was already used for another request.",
        );
      return this.prisma.exportRun.findFirst({
        where: {
          id: previous.resourceId,
          organizationId: identity.organizationId,
        },
      });
    }
    return this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.exportRun.create({
          data: {
            organizationId: identity.organizationId,
            format: input.format,
            filters: input.filters as Prisma.InputJsonValue,
            requestedBy: identity.userId,
            snapshotBoundary: new Date(),
            expiresAt: new Date(
              Date.now() +
                this.environment.ARTIFACT_RETENTION_HOURS * 3_600_000,
            ),
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            organizationId: identity.organizationId,
            key: idempotencyKey,
            requestHash,
            resourceType: "EXPORT",
            resourceId: run.id,
          },
        });
        await this.appendControlRecord(transaction, {
          identity,
          eventType: "export.run.requested",
          resourceType: "ExportRun",
          resourceId: run.id,
          outcome: "PENDING",
          metadata: {
            format: run.format,
            snapshotBoundary: run.snapshotBoundary.toISOString(),
          },
          correlationId,
        });
        return run;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async exports(identity: AuditIdentity) {
    return {
      items: await this.prisma.exportRun.findMany({
        where: { organizationId: identity.organizationId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    };
  }

  async export(identity: AuditIdentity, id: string) {
    const run = await this.prisma.exportRun.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!run) throw new NotFoundException("Export run not found.");
    return run;
  }

  async cancelExport(
    identity: AuditIdentity,
    id: string,
    idempotencyKey: string,
    correlationId: string,
  ) {
    if (!idempotencyKey)
      throw new BadRequestException("An idempotency-key header is required.");
    const requestHash = sha256(
      canonicalJson({ operation: "CANCEL_EXPORT", exportRunId: id }),
    );
    const previous = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_key: {
          organizationId: identity.organizationId,
          key: idempotencyKey,
        },
      },
    });
    if (previous) {
      if (
        previous.requestHash !== requestHash ||
        previous.resourceType !== "EXPORT_CANCEL"
      )
        throw new ConflictException(
          "The idempotency key was already used for another request.",
        );
      return this.export(identity, previous.resourceId);
    }
    return this.prisma.$transaction(
      async (transaction) => {
        const result = await transaction.exportRun.updateMany({
          where: {
            id,
            organizationId: identity.organizationId,
            state: "PENDING",
          },
          data: { state: "CANCELLED", completedAt: new Date() },
        });
        if (!result.count)
          throw new ConflictException(
            "Only a pending export can be safely cancelled.",
          );
        const run = await transaction.exportRun.findFirst({
          where: { id, organizationId: identity.organizationId },
        });
        if (!run) throw new NotFoundException("Export run not found.");
        await transaction.idempotencyRecord.create({
          data: {
            organizationId: identity.organizationId,
            key: idempotencyKey,
            requestHash,
            resourceType: "EXPORT_CANCEL",
            resourceId: run.id,
          },
        });
        await this.appendControlRecord(transaction, {
          identity,
          eventType: "export.run.cancelled",
          resourceType: "ExportRun",
          resourceId: run.id,
          correlationId,
        });
        return run;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async exportDownload(
    identity: AuditIdentity,
    id: string,
    correlationId: string,
  ) {
    const run = await this.export(identity, id);
    if (run.state !== "COMPLETED" || !run.artifactKey || !run.artifactFilename)
      throw new ConflictException("The export artifact is not available.");
    if (run.expiresAt <= new Date())
      throw new ConflictException("The export artifact has expired.");
    const grant = await this.storage.grant({
      key: run.artifactKey,
      filename: run.artifactFilename,
    });
    await this.prisma.$transaction(
      async (transaction) =>
        this.appendControlRecord(transaction, {
          identity,
          eventType: "export.artifact.download-granted",
          resourceType: "ExportRun",
          resourceId: run.id,
          metadata: {
            format: run.format,
            artifactMediaType: run.artifactMediaType,
          },
          correlationId,
        }),
      { isolationLevel: "Serializable" },
    );
    return grant;
  }

  async freshness() {
    const checkpoints = await this.prisma.consumerCheckpoint.findMany({
      orderBy: [{ topic: "asc" }, { partition: "asc" }],
    });
    const latest = checkpoints.reduce<Date | null>(
      (value, item) =>
        !value || item.updatedAt > value ? item.updatedAt : value,
      null,
    );
    return {
      status: checkpoints.length ? "CURRENT" : "INITIALIZING",
      projectionVersion: 1,
      lastIngestedAt: latest?.toISOString() ?? null,
      checkpoints: checkpoints.map((item) => ({
        ...item,
        offset: item.offset.toString(),
      })),
    };
  }

  async operations(identity: AuditIdentity) {
    const [quarantineOpen, auditCount, jobs, freshness] = await Promise.all([
      this.prisma.quarantinedEvent.count({ where: { resolvedAt: null } }),
      this.prisma.auditRecord.count({
        where: { organizationId: identity.organizationId },
      }),
      this.prisma.operationJob.findMany({
        where: { organizationId: identity.organizationId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      this.freshness(),
    ]);
    return { quarantineOpen, auditCount, jobs, freshness };
  }

  async createOperation(
    identity: AuditIdentity,
    raw: unknown,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const input = auditOperationRequestSchema.parse(raw);
    if (!idempotencyKey)
      throw new BadRequestException("An idempotency-key header is required.");
    const requestHash = sha256(canonicalJson(input));
    const previous = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_key: {
          organizationId: identity.organizationId,
          key: idempotencyKey,
        },
      },
    });
    if (previous) {
      if (
        previous.requestHash !== requestHash ||
        previous.resourceType !== "OPERATION"
      )
        throw new ConflictException(
          "The idempotency key was already used for another request.",
        );
      return this.prisma.operationJob.findFirst({
        where: {
          id: previous.resourceId,
          organizationId: identity.organizationId,
        },
      });
    }
    return this.prisma.$transaction(
      async (transaction) => {
        const job = await transaction.operationJob.create({
          data: {
            organizationId: identity.organizationId,
            type: input.type,
            reason: input.reason,
            dryRun: input.dryRun,
            parameters: input.parameters as Prisma.InputJsonValue,
            requestedBy: identity.userId,
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            organizationId: identity.organizationId,
            key: idempotencyKey,
            requestHash,
            resourceType: "OPERATION",
            resourceId: job.id,
          },
        });
        await this.appendControlRecord(transaction, {
          identity,
          eventType: "audit.operation.requested",
          resourceType: "AuditOperation",
          resourceId: job.id,
          outcome: "PENDING",
          metadata: {
            operationType: input.type,
            dryRun: input.dryRun,
            reason: input.reason,
          },
          correlationId,
        });
        return job;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async buildArtifactRows(
    organizationId: string,
    filters: Record<string, unknown>,
    snapshotBoundary: Date,
  ) {
    const parsed = auditSearchSchema
      .omit({ cursor: true, pageSize: true })
      .parse(filters);
    return this.prisma.auditRecord.findMany({
      where: this.where(organizationId, parsed, snapshotBoundary),
      orderBy:
        parsed.sort === "OCCURRED_DESC"
          ? [{ occurredAt: "desc" }, { id: "desc" }]
          : [{ occurredAt: "asc" }, { id: "asc" }],
      take: 5000,
    });
  }

  async buildCaseArtifactRows(
    organizationId: string,
    caseId: string,
    snapshotBoundary: Date,
    search?: string,
  ) {
    const caseScope: Prisma.AuditRecordWhereInput = {
      OR: [
        { resourceId: caseId },
        { metadata: { path: ["caseId"], equals: caseId } },
        { metadata: { path: ["case", "id"], equals: caseId } },
      ],
    };
    const textScope: Prisma.AuditRecordWhereInput | undefined = search
      ? {
          OR: [
            { eventType: { contains: search, mode: "insensitive" } },
            { sourceService: { contains: search, mode: "insensitive" } },
            { resourceType: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined;
    return this.prisma.auditRecord.findMany({
      where: {
        organizationId,
        occurredAt: { lte: snapshotBoundary },
        AND: textScope ? [caseScope, textScope] : [caseScope],
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 5000,
    });
  }

  renderJson(rows: Awaited<ReturnType<AuditService["buildArtifactRows"]>>) {
    return Buffer.from(
      JSON.stringify(
        {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          rowCount: rows.length,
          items: rows.map(serializeRecord),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  renderCsv(rows: Awaited<ReturnType<AuditService["buildArtifactRows"]>>) {
    const header = csvRow([
      "audit_id",
      "occurred_at",
      "source_service",
      "event_type",
      "actor_type",
      "actor_id",
      "resource_type",
      "resource_id",
      "outcome",
      "classification",
      "correlation_id",
      "record_hash",
    ]);
    const body = rows.map((row) =>
      csvRow([
        row.id,
        row.occurredAt.toISOString(),
        row.sourceService,
        row.eventType,
        row.actorType,
        row.actorId,
        row.resourceType,
        row.resourceId,
        row.outcome,
        row.classification,
        row.correlationId,
        row.recordHash,
      ]),
    );
    return Buffer.from(`\uFEFF${[header, ...body].join("\r\n")}\r\n`, "utf8");
  }

  checksum(buffer: Buffer) {
    return createHash("sha256").update(buffer).digest("hex");
  }
}
