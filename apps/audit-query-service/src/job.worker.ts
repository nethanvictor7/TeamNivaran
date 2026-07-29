import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Prisma } from "@cdep/audit-prisma-client";
import { AuditService } from "./audit.service.js";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";
import { ArtifactStorage } from "./storage.service.js";

@Injectable()
export class AuditJobWorker implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly logger = new Logger(AuditJobWorker.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: ArtifactStorage,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick(),
      this.environment.JOB_POLL_INTERVAL_MS,
    );
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const report = await this.prisma.reportRun.findFirst({
        where: { state: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (report) {
        await this.processReport(report.id);
        return;
      }
      const exportRun = await this.prisma.exportRun.findFirst({
        where: { state: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (exportRun) {
        await this.processExport(exportRun.id);
        return;
      }
      const operation = await this.prisma.operationJob.findFirst({
        where: { state: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (operation) await this.processOperation(operation.id);
    } finally {
      this.busy = false;
    }
  }

  private async processReport(id: string) {
    const claimed = await this.prisma.reportRun.updateMany({
      where: { id, state: "PENDING" },
      data: { state: "RUNNING", startedAt: new Date() },
    });
    if (!claimed.count) return;
    const run = await this.prisma.reportRun.findUniqueOrThrow({
      where: { id },
    });
    try {
      const parameters = run.parameters as Record<string, unknown>;
      const filters: Record<string, unknown> = {};
      const caseId =
        typeof parameters.caseId === "string" ? parameters.caseId : undefined;
      if (run.reportKey === "EVIDENCE_VALIDATION_HISTORY")
        filters.search = "evidence";
      if (run.reportKey === "HUMAN_DECISION_SUMMARY")
        filters.search = "decision";
      if (run.reportKey === "LEDGER_VERIFICATION_HISTORY")
        filters.search = "proof";
      if (run.reportKey === "AI_ASSESSMENT_GOVERNANCE")
        filters.search = "assessment";
      const rows = caseId
        ? await this.audit.buildCaseArtifactRows(
            run.organizationId,
            caseId,
            run.snapshotBoundary,
            typeof filters.search === "string" ? filters.search : undefined,
          )
        : await this.audit.buildArtifactRows(
            run.organizationId,
            filters,
            run.snapshotBoundary,
          );
      const body = this.audit.renderJson(rows);
      const checksum = this.audit.checksum(body);
      const filename = `${run.reportKey.toLowerCase()}-${run.id}.json`;
      const key = `organizations/${run.organizationId}/reports/${run.id}/${filename}`;
      const stored = await this.storage.put({
        key,
        body,
        mediaType: "application/json",
        checksumSha256: checksum,
      });
      await this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          state: "COMPLETED",
          rowCount: rows.length,
          checksumSha256: checksum,
          artifactBucket: stored.bucket,
          artifactKey: stored.key,
          artifactMediaType: "application/json",
          artifactFilename: filename,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error({
        event: "audit.report.failed",
        runId: run.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      await this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          state: "FAILED",
          failureCode: "ARTIFACT_GENERATION_FAILED",
          completedAt: new Date(),
        },
      });
    }
  }

  private async processExport(id: string) {
    const claimed = await this.prisma.exportRun.updateMany({
      where: { id, state: "PENDING" },
      data: { state: "RUNNING", startedAt: new Date() },
    });
    if (!claimed.count) return;
    const run = await this.prisma.exportRun.findUniqueOrThrow({
      where: { id },
    });
    try {
      const rows = await this.audit.buildArtifactRows(
        run.organizationId,
        run.filters as Record<string, unknown>,
        run.snapshotBoundary,
      );
      const body =
        run.format === "CSV"
          ? this.audit.renderCsv(rows)
          : this.audit.renderJson(rows);
      const mediaType =
        run.format === "CSV" ? "text/csv; charset=utf-8" : "application/json";
      const extension = run.format.toLowerCase();
      const filename = `audit-export-${run.id}.${extension}`;
      const key = `organizations/${run.organizationId}/exports/${run.id}/${filename}`;
      const checksum = this.audit.checksum(body);
      const stored = await this.storage.put({
        key,
        body,
        mediaType,
        checksumSha256: checksum,
      });
      await this.prisma.exportRun.update({
        where: { id: run.id },
        data: {
          state: "COMPLETED",
          rowCount: rows.length,
          checksumSha256: checksum,
          artifactBucket: stored.bucket,
          artifactKey: stored.key,
          artifactMediaType: mediaType,
          artifactFilename: filename,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error({
        event: "audit.export.failed",
        runId: run.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      await this.prisma.exportRun.update({
        where: { id: run.id },
        data: {
          state: "FAILED",
          failureCode: "ARTIFACT_GENERATION_FAILED",
          completedAt: new Date(),
        },
      });
    }
  }

  private async processOperation(id: string) {
    const claimed = await this.prisma.operationJob.updateMany({
      where: { id, state: "PENDING" },
      data: { state: "RUNNING", startedAt: new Date() },
    });
    if (!claimed.count) return;
    const job = await this.prisma.operationJob.findUniqueOrThrow({
      where: { id },
    });
    try {
      const chain = await this.audit.verifyChain(
        {
          organizationId: job.organizationId,
          userId: job.requestedBy,
          permissions: [],
        },
        5000,
      );
      const count = await this.prisma.auditRecord.count({
        where: { organizationId: job.organizationId },
      });
      const result: Prisma.InputJsonValue = {
        operation: job.type,
        dryRun: job.dryRun,
        recordsExamined: count,
        chainStatus: chain.status,
        projectionVersion: 1,
        currentProjectionPreserved: true,
      };
      await this.prisma.operationJob.update({
        where: { id: job.id },
        data: {
          state: chain.status === "VERIFIED" ? "COMPLETED" : "FAILED",
          result,
          ...(chain.status === "VERIFIED"
            ? {}
            : { failureCode: "AUDIT_CHAIN_VERIFICATION_FAILED" }),
          completedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error({
        event: "audit.operation.failed",
        jobId: job.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      await this.prisma.operationJob.update({
        where: { id: job.id },
        data: {
          state: "FAILED",
          failureCode: "OPERATION_FAILED",
          completedAt: new Date(),
        },
      });
    }
  }
}
