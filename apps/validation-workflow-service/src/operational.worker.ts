import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";
import { WorkflowService } from "./workflow.service.js";

@Injectable()
export class OperationalWorker implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick(),
      this.environment.WORKFLOW_TIMER_POLL_INTERVAL_MS,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    const now = new Date();
    await this.prisma.workflowTask.updateMany({
      where: {
        status: { in: ["PENDING", "CLAIMED"] },
        dueAt: { lt: now },
      },
      data: { status: "EXPIRED", rowVersion: { increment: 1 } },
    });
    const operations = await this.prisma.caseSyncOperation.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        attempts: { lt: this.environment.WORKFLOW_CASE_SYNC_MAX_ATTEMPTS },
      },
      take: 10,
    });
    for (const operation of operations)
      await this.workflows.attemptCaseSync(
        operation.workflowInstanceId,
        randomUUID(),
      );
  }
}
