import { Controller, Get, Header } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

const metricLabel = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

@Controller()
export class MetricsController {
  constructor(private readonly db: PrismaService) {}

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics() {
    const [
      triggers,
      runs,
      completedRuns,
      checkpoints,
      correlations,
      replays,
      failed,
      connectorFailures,
      pendingOutbox,
      oldestOutbox,
    ] = await Promise.all([
      this.db.sourceTrigger.groupBy({
        by: ["connectorType", "status"],
        _count: { _all: true },
      }),
      this.db.ingestionRun.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { rowsCaptured: true },
      }),
      this.db.ingestionRun.findMany({
        where: { completedAt: { not: null } },
        select: { startedAt: true, completedAt: true },
        orderBy: { completedAt: "desc" },
        take: 1000,
      }),
      this.db.connectorCheckpoint.findMany({ select: { updatedAt: true } }),
      this.db.journeyCorrelation.groupBy({
        by: ["outcome"],
        _count: { _all: true },
      }),
      this.db.replayRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      this.db.failedTrigger.count({ where: { resolvedAt: null } }),
      this.db.connectorDefinition.count({
        where: { lastErrorCode: { not: null } },
      }),
      this.db.outboxEvent.count({ where: { publishedAt: null } }),
      this.db.outboxEvent.findFirst({
        where: { publishedAt: null },
        orderBy: { occurredAt: "asc" },
        select: { occurredAt: true },
      }),
    ]);
    const lines = [
      "# HELP cdep_source_triggers_total Captured source triggers by connector and processing state.",
      "# TYPE cdep_source_triggers_total counter",
      ...triggers.map(
        (row) =>
          `cdep_source_triggers_total{connector_type="${metricLabel(row.connectorType)}",status="${metricLabel(row.status)}"} ${row._count._all}`,
      ),
      "# HELP cdep_sql_poll_runs_total SQL polling runs by outcome.",
      "# TYPE cdep_sql_poll_runs_total counter",
      ...runs.map(
        (row) =>
          `cdep_sql_poll_runs_total{status="${metricLabel(row.status)}"} ${row._count._all}`,
      ),
      "# HELP cdep_sql_rows_captured_total Rows durably captured by SQL polling.",
      "# TYPE cdep_sql_rows_captured_total counter",
      `cdep_sql_rows_captured_total ${runs.reduce((sum, row) => sum + (row._sum.rowsCaptured ?? 0), 0)}`,
      "# HELP cdep_sql_poll_duration_seconds_sum Duration of the most recent SQL polling runs.",
      "# TYPE cdep_sql_poll_duration_seconds_sum counter",
      `cdep_sql_poll_duration_seconds_sum ${completedRuns.reduce((sum, run) => sum + (run.completedAt!.valueOf() - run.startedAt.valueOf()) / 1000, 0)}`,
      "# HELP cdep_sql_poll_duration_seconds_count Number of completed SQL polling runs included in the duration sum.",
      "# TYPE cdep_sql_poll_duration_seconds_count counter",
      `cdep_sql_poll_duration_seconds_count ${completedRuns.length}`,
      "# HELP cdep_sql_checkpoint_lag_seconds Age of the oldest active checkpoint update.",
      "# TYPE cdep_sql_checkpoint_lag_seconds gauge",
      `cdep_sql_checkpoint_lag_seconds ${checkpoints.length ? Math.max(...checkpoints.map((checkpoint) => Math.max(0, (Date.now() - checkpoint.updatedAt.valueOf()) / 1000))) : 0}`,
      "# HELP cdep_correlation_outcomes_total Correlation outcomes.",
      "# TYPE cdep_correlation_outcomes_total counter",
      ...correlations.map(
        (row) =>
          `cdep_correlation_outcomes_total{outcome="${metricLabel(row.outcome)}"} ${row._count._all}`,
      ),
      "# HELP cdep_replay_requests_total Replay requests by outcome.",
      "# TYPE cdep_replay_requests_total counter",
      ...replays.map(
        (row) =>
          `cdep_replay_requests_total{status="${metricLabel(row.status)}"} ${row._count._all}`,
      ),
      "# HELP cdep_failed_triggers Current unresolved failed-trigger count.",
      "# TYPE cdep_failed_triggers gauge",
      `cdep_failed_triggers ${failed}`,
      "# HELP cdep_connector_failures Connectors currently reporting an error.",
      "# TYPE cdep_connector_failures gauge",
      `cdep_connector_failures ${connectorFailures}`,
      "# HELP cdep_outbox_pending Current unpublished outbox count.",
      "# TYPE cdep_outbox_pending gauge",
      `cdep_outbox_pending ${pendingOutbox}`,
      "# HELP cdep_outbox_oldest_pending_seconds Age of the oldest unpublished outbox row.",
      "# TYPE cdep_outbox_oldest_pending_seconds gauge",
      `cdep_outbox_oldest_pending_seconds ${oldestOutbox ? Math.max(0, (Date.now() - oldestOutbox.occurredAt.valueOf()) / 1000) : 0}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}
