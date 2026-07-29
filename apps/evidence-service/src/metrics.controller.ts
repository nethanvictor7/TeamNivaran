import { Controller, Get, Header } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

function label(value: string) {
  return value.replace(/[^A-Z0-9_]/gi, "_");
}

@Controller()
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4")
  async metrics() {
    const [
      versions,
      jobs,
      scans,
      checks,
      pendingOutbox,
      inboxDuplicates,
      orphans,
    ] = await Promise.all([
      this.prisma.evidenceVersion.groupBy({
        by: ["processingStatus"],
        _count: { _all: true },
      }),
      this.prisma.evidenceProcessingJob.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.malwareScanAttempt.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.evidenceIntegrityCheck.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
      this.prisma.inboxEvent.count(),
      this.prisma.orphanObjectCandidate.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);
    return [
      "# HELP cdep_evidence_versions Evidence versions by processing status.",
      "# TYPE cdep_evidence_versions gauge",
      ...versions.map(
        (row) =>
          `cdep_evidence_versions{status="${label(row.processingStatus)}"} ${row._count._all}`,
      ),
      "# HELP cdep_evidence_processing_jobs Evidence jobs by status.",
      "# TYPE cdep_evidence_processing_jobs gauge",
      ...jobs.map(
        (row) =>
          `cdep_evidence_processing_jobs{status="${label(row.status)}"} ${row._count._all}`,
      ),
      "# HELP cdep_evidence_scan_outcomes Malware scan outcomes.",
      "# TYPE cdep_evidence_scan_outcomes counter",
      ...scans.map(
        (row) =>
          `cdep_evidence_scan_outcomes{status="${label(row.status)}"} ${row._count._all}`,
      ),
      "# HELP cdep_evidence_integrity_results Integrity-check results.",
      "# TYPE cdep_evidence_integrity_results counter",
      ...checks.map(
        (row) =>
          `cdep_evidence_integrity_results{status="${label(row.status)}"} ${row._count._all}`,
      ),
      `cdep_evidence_outbox_pending ${pendingOutbox}`,
      `cdep_evidence_inbox_processed ${inboxDuplicates}`,
      ...orphans.map(
        (row) =>
          `cdep_evidence_orphan_candidates{status="${label(row.status)}"} ${row._count._all}`,
      ),
      "",
    ].join("\n");
  }
}
