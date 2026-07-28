import {
  BadRequestException,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Injectable,
  NotFoundException,
  Post,
  Body,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Prisma } from "@cdep/workflow-prisma-client";
import { timingSafeEqual } from "node:crypto";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class WorkflowInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const header = context.switchToHttp().getRequest().headers[
      "x-cdep-internal-service-token"
    ];
    const supplied = Buffer.from(typeof header === "string" ? header : "");
    const expected = Buffer.from(getEnvironment().INTERNAL_SERVICE_TOKEN);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new UnauthorizedException(
        "Internal service authentication failed.",
      );
    return true;
  }
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

@Controller("internal/v1/workflow")
@UseGuards(WorkflowInternalGuard)
export class WorkflowInternalController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("assessment-context")
  async context(@Body() body: Record<string, unknown>) {
    if (
      typeof body.organizationId !== "string" ||
      typeof body.caseId !== "string"
    )
      throw new BadRequestException("Invalid Workflow context request.");
    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        organizationId: body.organizationId,
        caseId: body.caseId,
        active: true,
      },
      include: {
        definitionVersion: true,
        validations: {
          include: { results: true },
          orderBy: { runNumber: "desc" },
        },
        tasks: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!instance) throw new NotFoundException("Active Workflow not found.");
    const validation = instance.validations.find(
      (item) => item.id === instance.currentValidationRunId,
    );
    if (!validation)
      throw new ConflictException(
        "The Workflow does not have a current validation snapshot.",
      );
    return {
      id: instance.id,
      caseId: instance.caseId,
      state: instance.state,
      cycleNumber: instance.cycleNumber,
      rowVersion: instance.rowVersion,
      workflowDefinitionVersionId: instance.workflowDefinitionVersionId,
      definition: {
        id: instance.definitionVersion.id,
        versionNumber: instance.definitionVersion.versionNumber,
        configuration: instance.definitionVersion.configuration,
      },
      validation: {
        id: validation.id,
        status: validation.status,
        caseSnapshot: validation.caseSnapshot,
        evidenceSnapshot: validation.evidenceSnapshot,
        results: validation.results,
      },
      tasks: instance.tasks,
    };
  }

  @Post("assessment-acceptance")
  async acceptance(@Body() body: Record<string, unknown>) {
    if (
      typeof body.organizationId !== "string" ||
      typeof body.caseId !== "string" ||
      typeof body.workflowInstanceId !== "string" ||
      typeof body.assessmentId !== "string" ||
      typeof body.actorId !== "string" ||
      typeof body.expectedWorkflowVersion !== "number" ||
      !Array.isArray(body.selectedItems) ||
      body.selectedItems.length === 0
    )
      throw new BadRequestException("Invalid assessment acceptance request.");
    const instance = await this.prisma.workflowInstance.findFirst({
      where: {
        id: body.workflowInstanceId,
        organizationId: body.organizationId,
        caseId: body.caseId,
        active: true,
      },
    });
    if (!instance) throw new NotFoundException("Active Workflow not found.");
    if (
      instance.rowVersion !== body.expectedWorkflowVersion ||
      !["UNDER_REVIEW", "READY_FOR_RECOMMENDATION"].includes(instance.state)
    )
      throw new ConflictException(
        "Workflow state or version no longer permits a draft acceptance.",
      );
    const draft = await this.prisma.workflowRecommendationDraft.create({
      data: {
        organizationId: body.organizationId,
        workflowInstanceId: instance.id,
        caseId: instance.caseId,
        cycleNumber: instance.cycleNumber,
        createdBy: body.actorId,
        aiProvenance: {
          create: {
            assessmentId: body.assessmentId,
            selectedItems: json(body.selectedItems),
            acceptedBy: body.actorId,
          },
        },
      },
    });
    return { draftId: draft.id, workflowVersion: instance.rowVersion };
  }

  @Post("decision-proof-snapshot")
  async decisionProofSnapshot(@Body() body: Record<string, unknown>) {
    if (
      typeof body.organizationId !== "string" ||
      typeof body.caseId !== "string"
    )
      throw new BadRequestException("Invalid decision proof request.");
    const decision = await this.prisma.decisionRecord.findFirst({
      where: {
        organizationId: body.organizationId,
        caseId: body.caseId,
        outcome: { in: ["APPROVED", "REJECTED"] },
      },
      include: {
        recommendation: true,
        evidence: { orderBy: { evidenceVersionId: "asc" } },
      },
      orderBy: { decidedAt: "desc" },
    });
    if (!decision)
      throw new NotFoundException("Terminal human decision not found.");
    return {
      organizationId: decision.organizationId,
      caseId: decision.caseId,
      workflowInstanceId: decision.workflowInstanceId,
      decision: {
        id: decision.id,
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        decidedAt: decision.decidedAt.toISOString(),
        validationRunId: decision.validationRunId,
        cycleNumber: decision.cycleNumber,
        definitionVersionSnapshot: decision.definitionVersionSnapshot,
      },
      recommendation: {
        id: decision.recommendation.id,
        outcome: decision.recommendation.outcome,
        reasonCodes: decision.recommendation.reasonCodes,
        conditions: decision.recommendation.conditions,
        supportingAssessmentIds:
          decision.recommendation.supportingAssessmentIds,
        submittedAt: decision.recommendation.submittedAt.toISOString(),
      },
      evidenceManifest: decision.evidence.map((item) => ({
        evidenceAssetId: item.evidenceAssetId,
        evidenceVersionId: item.evidenceVersionId,
        sha256: item.sha256,
        classificationCode: item.classificationCode,
        availableAt: item.availableAt.toISOString(),
      })),
    };
  }
}
