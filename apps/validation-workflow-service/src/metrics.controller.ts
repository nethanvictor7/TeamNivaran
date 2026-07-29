import { Controller, Get, Header } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @Header("content-type", "text/plain; version=0.0.4")
  async metrics() {
    const [active, openTasks, pendingOutbox, failedSync] = await Promise.all([
      this.prisma.workflowInstance.count({ where: { active: true } }),
      this.prisma.workflowTask.count({
        where: { status: { in: ["PENDING", "CLAIMED"] } },
      }),
      this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
      this.prisma.caseSyncOperation.count({ where: { status: "FAILED" } }),
    ]);
    return [
      "# TYPE cdep_workflow_active_instances gauge",
      `cdep_workflow_active_instances ${active}`,
      "# TYPE cdep_workflow_open_tasks gauge",
      `cdep_workflow_open_tasks ${openTasks}`,
      "# TYPE cdep_workflow_outbox_pending gauge",
      `cdep_workflow_outbox_pending ${pendingOutbox}`,
      "# TYPE cdep_workflow_case_sync_failed gauge",
      `cdep_workflow_case_sync_failed ${failedSync}`,
      "",
    ].join("\n");
  }
}
