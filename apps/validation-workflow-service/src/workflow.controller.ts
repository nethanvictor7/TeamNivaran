import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { z } from "zod";
import {
  AuthenticationGuard,
  type AuthenticatedRequest,
  Permission,
} from "./authentication.js";
import {
  assignSchema,
  claimSchema,
  commentSchema,
  correctionSchema,
  createDefinitionSchema,
  decisionSchema,
  definitionVersionSchema,
  recommendationSchema,
  reopenSchema,
  reviewSchema,
  startSchema,
  updateDefinitionSchema,
  versionCommandSchema,
  withdrawSchema,
  WorkflowService,
} from "./workflow.service.js";

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((issue) => issue.message).join("; "),
    );
  return result.data;
}

@Controller("api/v1")
@UseGuards(AuthenticationGuard)
export class WorkflowController {
  constructor(private readonly workflows: WorkflowService) {}

  @Post("workflow-definitions")
  @Permission("workflow:definition:manage")
  createDefinition(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.createDefinition(
      parse(createDefinitionSchema, body),
      request.identity,
    );
  }

  @Get("workflow-definitions")
  @Permission("workflow:definition:read")
  definitions(@Req() request: AuthenticatedRequest) {
    return this.workflows.listDefinitions(request.identity);
  }

  @Get("workflow-definitions/:definitionId")
  @Permission("workflow:definition:read")
  definition(
    @Param("definitionId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.getDefinition(id, request.identity);
  }

  @Patch("workflow-definitions/:definitionId")
  @Permission("workflow:definition:manage")
  updateDefinition(
    @Param("definitionId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.updateDefinition(
      id,
      parse(updateDefinitionSchema, body),
      request.identity,
    );
  }

  @Post("workflow-definitions/:definitionId/versions")
  @Permission("workflow:definition:manage")
  createVersion(
    @Param("definitionId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.createVersion(
      id,
      parse(definitionVersionSchema, body),
      request.identity,
    );
  }

  @Patch("workflow-definitions/:definitionId/versions/:versionId")
  @Permission("workflow:definition:manage")
  updateVersion(
    @Param("definitionId") definitionId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.updateVersion(
      definitionId,
      versionId,
      parse(definitionVersionSchema, body),
      request.identity,
    );
  }

  @Post("workflow-definitions/:definitionId/versions/:versionId/publish")
  @Permission("workflow:definition:manage")
  publish(
    @Param("definitionId") definitionId: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.publishVersion(
      definitionId,
      versionId,
      request.identity,
      request.id,
    );
  }

  @Post("workflow-definitions/:definitionId/versions/:versionId/retire")
  @Permission("workflow:definition:manage")
  retire(
    @Param("definitionId") definitionId: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.retireVersion(
      definitionId,
      versionId,
      request.identity,
    );
  }

  @Post("cases/:caseId/workflow/start")
  @Permission("workflow:start")
  start(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.start(
      caseId,
      parse(startSchema, body ?? {}),
      request.identity,
      request.id,
      key ?? "",
    );
  }

  @Get("cases/:caseId/workflow")
  @Permission("workflow:read")
  caseWorkflow(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.getCaseWorkflow(caseId, request.identity, request.id);
  }

  @Get("cases/:caseId/workflow/history")
  @Permission("workflow:read")
  history(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.history(caseId, request.identity);
  }

  @Post("cases/:caseId/workflow/validate")
  @HttpCode(200)
  @Permission("validation:run")
  validate(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.validate(
      caseId,
      parse(versionCommandSchema, body),
      request.identity,
      request.id,
    );
  }

  @Get("cases/:caseId/workflow/validations")
  @Permission("workflow:read")
  validations(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.validations(caseId, request.identity);
  }

  @Post("cases/:caseId/workflow/resubmit")
  @HttpCode(200)
  @Permission("review:submit")
  resubmit(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.resubmit(
      caseId,
      parse(versionCommandSchema, body),
      request.identity,
      request.id,
    );
  }

  @Post("cases/:caseId/workflow/withdraw")
  @HttpCode(200)
  @Permission("workflow:withdraw")
  withdraw(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.withdraw(
      caseId,
      parse(withdrawSchema, body),
      request.identity,
      request.id,
    );
  }

  @Post("cases/:caseId/workflow/reopen")
  @HttpCode(200)
  @Permission("workflow:reopen")
  reopen(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.reopen(
      caseId,
      parse(reopenSchema, body),
      request.identity,
      request.id,
      key ?? "",
    );
  }

  @Get("workflow/tasks")
  @Permission("workflow:task:read")
  tasks(
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.tasks(request.identity, query);
  }

  @Get("workflow/tasks/:taskId")
  @Permission("workflow:task:read")
  task(@Param("taskId") taskId: string, @Req() request: AuthenticatedRequest) {
    return this.workflows.task(taskId, request.identity);
  }

  @Post("workflow/tasks/:taskId/claim")
  @HttpCode(200)
  @Permission("workflow:task:claim")
  claim(
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.claim(
      taskId,
      parse(claimSchema, body),
      request.identity,
      request.id,
    );
  }

  @Post("workflow/tasks/:taskId/assign")
  @HttpCode(200)
  @Permission("workflow:task:assign")
  assign(
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.assign(
      taskId,
      parse(assignSchema, body),
      request.identity,
      request.id,
    );
  }

  @Post("workflow/tasks/:taskId/comments")
  @HttpCode(200)
  @Permission("workflow:comment")
  comment(
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.addComment(
      taskId,
      parse(commentSchema, body),
      request.identity,
    );
  }

  @Post("workflow/tasks/:taskId/request-correction")
  @HttpCode(200)
  @Permission("correction:request")
  correction(
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.requestCorrection(
      taskId,
      parse(correctionSchema, body),
      request.identity,
      request.id,
    );
  }

  @Post("workflow/tasks/:taskId/submit-review")
  @HttpCode(200)
  @Permission("review:submit")
  submitReview(
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.submitReview(
      taskId,
      parse(reviewSchema, body),
      request.identity,
      request.id,
    );
  }

  @Post("cases/:caseId/recommendations")
  @HttpCode(200)
  @Permission("decision:recommend")
  recommend(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.recommend(
      caseId,
      parse(recommendationSchema, body),
      request.identity,
      request.id,
    );
  }

  @Get("cases/:caseId/recommendations")
  @Permission("workflow:read")
  recommendations(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.recommendations(caseId, request.identity);
  }

  @Post("cases/:caseId/decision/approve")
  @HttpCode(201)
  @Permission("decision:approve")
  approve(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.decide(
      caseId,
      "APPROVED",
      parse(decisionSchema, body),
      request.identity,
      request.id,
      key ?? "",
    );
  }

  @Post("cases/:caseId/decision/reject")
  @HttpCode(201)
  @Permission("decision:reject")
  reject(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.decide(
      caseId,
      "REJECTED",
      parse(decisionSchema, body),
      request.identity,
      request.id,
      key ?? "",
    );
  }

  @Get("cases/:caseId/decision")
  @Permission("workflow:read")
  decision(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.decision(caseId, request.identity);
  }

  @Get("cases/:caseId/decisions")
  @Permission("decision:read")
  decisions(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.decisions(caseId, request.identity);
  }

  @Get("decisions/:decisionId")
  @Permission("decision:read")
  decisionById(
    @Param("decisionId") decisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.decisionById(decisionId, request.identity);
  }
}
