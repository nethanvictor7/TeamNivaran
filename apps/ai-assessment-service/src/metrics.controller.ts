import { Controller, Get, Header } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @Header("content-type", "text/plain; version=0.0.4")
  async metrics() {
    const groups = await this.prisma.assessment.groupBy({
      by: ["status"],
      _count: true,
    });
    return [
      "# HELP cdep_ai_assessments Assessments by persisted status.",
      "# TYPE cdep_ai_assessments gauge",
      ...groups.map(
        (group) =>
          `cdep_ai_assessments{status="${group.status}"} ${group._count}`,
      ),
      "",
    ].join("\n");
  }
}
