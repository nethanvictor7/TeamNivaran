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
  acceptanceSchema,
  AssessmentService,
  createAssessmentSchema,
  feedbackSchema,
  killSwitchSchema,
  modelPolicySchema,
  modelPolicyPatchSchema,
  promptTemplateSchema,
  promptVersionSchema,
  promptVersionPatchSchema,
  runtimeConfigSchema,
  runtimeConfigPatchSchema,
} from "./assessment.service.js";

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
export class AssessmentController {
  constructor(private readonly assessments: AssessmentService) {}

  @Post("cases/:caseId/ai-assessments")
  @HttpCode(202)
  @Permission("assessment:request")
  request(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.request(
      caseId,
      parse(createAssessmentSchema, body),
      request.identity,
      request.id,
      key ?? "",
    );
  }
  @Get("cases/:caseId/ai-assessments")
  @Permission("assessment:read")
  list(@Param("caseId") caseId: string, @Req() request: AuthenticatedRequest) {
    return this.assessments.list(caseId, request.identity);
  }
  @Get("ai-assessments/:assessmentId")
  @Permission("assessment:read")
  get(@Param("assessmentId") id: string, @Req() request: AuthenticatedRequest) {
    return this.assessments.get(id, request.identity);
  }
  @Post("ai-assessments/:assessmentId/cancel")
  @HttpCode(200)
  @Permission("assessment:cancel")
  cancel(
    @Param("assessmentId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.cancel(id, request.identity, request.id);
  }
  @Post("ai-assessments/:assessmentId/feedback")
  @Permission("assessment:feedback")
  feedback(
    @Param("assessmentId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.feedback(
      id,
      parse(feedbackSchema, body),
      request.identity,
    );
  }
  @Post("ai-assessments/:assessmentId/acceptance")
  @Permission("assessment:accept")
  accept(
    @Param("assessmentId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.accept(
      id,
      parse(acceptanceSchema, body),
      request.identity,
      request.id,
    );
  }
  @Get("ai-assessments/:assessmentId/input-refs")
  @Permission("assessment:read")
  refs(
    @Param("assessmentId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.inputRefs(id, request.identity);
  }
  @Get("ai-assessments/:assessmentId/input-references")
  @Permission("assessment:read")
  inputReferences(
    @Param("assessmentId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.inputRefs(id, request.identity);
  }
  @Get("ai-assessments/:assessmentId/executions")
  @Permission("assessment:operations")
  executions(
    @Param("assessmentId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.executions(id, request.identity);
  }

  @Get("ai-governance")
  @Permission("ai-governance:read")
  governance(@Req() request: AuthenticatedRequest) {
    return this.assessments.governance(request.identity);
  }
  @Get("ai-governance/cortex-configurations")
  @Permission("ai-governance:read")
  runtimes(@Req() request: AuthenticatedRequest) {
    return this.assessments.runtimeConfigurations(request.identity);
  }
  @Post("ai-governance/runtime-configs")
  @Permission("ai-governance:manage")
  runtime(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assessments.createRuntime(
      parse(runtimeConfigSchema, body),
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/cortex-configurations")
  @Permission("ai-governance:manage")
  cortexConfiguration(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.createRuntime(
      parse(runtimeConfigSchema, body),
      request.identity,
      request.id,
    );
  }
  @Patch("ai-governance/cortex-configurations/:id")
  @Permission("ai-governance:manage")
  updateCortexConfiguration(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.updateRuntime(
      id,
      parse(runtimeConfigPatchSchema, body),
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/cortex-configurations/:id/test")
  @HttpCode(200)
  @Permission("ai-governance:test")
  testCortexConfiguration(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.testRuntime(id, request.identity, request.id);
  }
  @Get("ai-governance/model-policies")
  @Permission("ai-governance:read")
  policies(@Req() request: AuthenticatedRequest) {
    return this.assessments.modelPolicies(request.identity);
  }
  @Post("ai-governance/model-policies")
  @Permission("ai-governance:manage")
  policy(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assessments.createPolicy(
      parse(modelPolicySchema, body),
      request.identity,
      request.id,
    );
  }
  @Patch("ai-governance/model-policies/:id")
  @Permission("ai-governance:manage")
  updatePolicy(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.updatePolicy(
      id,
      parse(modelPolicyPatchSchema, body),
      request.identity,
      request.id,
    );
  }
  @Get("ai-governance/prompt-templates")
  @Permission("ai-governance:read")
  promptTemplates(@Req() request: AuthenticatedRequest) {
    return this.assessments.promptTemplates(request.identity);
  }
  @Post("ai-governance/prompt-templates")
  @Permission("ai-governance:manage")
  template(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assessments.createTemplate(
      parse(promptTemplateSchema, body),
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/prompt-templates/:templateId/versions")
  @Permission("ai-governance:manage")
  version(
    @Param("templateId") templateId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.createPromptVersion(
      templateId,
      parse(promptVersionSchema, body),
      request.identity,
      request.id,
    );
  }
  @Patch("ai-governance/prompt-templates/:templateId/versions/:versionId")
  @Permission("ai-governance:manage")
  updateVersion(
    @Param("templateId") templateId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.updatePromptVersion(
      templateId,
      versionId,
      parse(promptVersionPatchSchema, body),
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/prompt-versions/:versionId/publish")
  @Permission("ai-governance:publish")
  publish(
    @Param("versionId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.publishPromptVersion(
      id,
      request.identity,
      request.id,
    );
  }
  @Post(
    "ai-governance/prompt-templates/:templateId/versions/:versionId/publish",
  )
  @Permission("ai-governance:publish")
  publishNested(
    @Param("templateId") _templateId: string,
    @Param("versionId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.publishPromptVersion(
      id,
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/prompt-versions/:versionId/retire")
  @Permission("ai-governance:publish")
  retire(@Param("versionId") id: string, @Req() request: AuthenticatedRequest) {
    return this.assessments.retirePromptVersion(
      id,
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/prompt-templates/:templateId/versions/:versionId/retire")
  @Permission("ai-governance:publish")
  retireNested(
    @Param("templateId") _templateId: string,
    @Param("versionId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.retirePromptVersion(
      id,
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/kill-switches")
  @Permission("ai-governance:kill-switch")
  killSwitch(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assessments.setKillSwitch(
      parse(killSwitchSchema, body),
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/kill-switches/activate")
  @Permission("ai-governance:kill-switch")
  activateKillSwitch(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parse(killSwitchSchema.omit({ enabled: true }), body);
    return this.assessments.setKillSwitch(
      { ...input, enabled: true },
      request.identity,
      request.id,
    );
  }
  @Post("ai-governance/kill-switches/deactivate")
  @Permission("ai-governance:kill-switch")
  deactivateKillSwitch(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parse(killSwitchSchema.omit({ enabled: true }), body);
    return this.assessments.setKillSwitch(
      { ...input, enabled: false },
      request.identity,
      request.id,
    );
  }
  @Get("ai-governance/operations")
  @Permission("assessment:operations")
  operations(@Req() request: AuthenticatedRequest) {
    return this.assessments.operations(request.identity);
  }
  @Post("ai-governance/operations/:assessmentId/retry")
  @Permission("assessment:operations")
  retry(
    @Param("assessmentId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.retryOperationTarget(id, request.identity);
  }
  @Post("ai-governance/operations/failures/:failureId/retry")
  @Permission("assessment:operations")
  retryFailure(
    @Param("failureId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.retryFailure(id, request.identity);
  }
}
