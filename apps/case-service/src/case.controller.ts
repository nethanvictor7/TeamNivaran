import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import {
  cancelCaseRequestSchema,
  createCaseAssignmentRequestSchema,
  createCaseExternalReferenceRequestSchema,
  createCasePartyRequestSchema,
  createCaseRequestSchema,
  updateCaseRequestSchema,
} from "@cdep/contracts";
import {
  AuthenticationGuard,
  type AuthenticatedRequest,
  Permission,
} from "./authentication.js";
import { CaseService } from "./case.service.js";

@Controller("api/v1/cases")
@UseGuards(AuthenticationGuard)
export class CaseController {
  constructor(private readonly cases: CaseService) {}
  private parse<T>(
    schema: { safeParse(value: unknown): any },
    value: unknown,
  ): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((x: any) => x.message).join("; "),
      );
    return parsed.data;
  }
  @Post()
  @Permission("case:create")
  create(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.cases.create(
      this.parse(createCaseRequestSchema, body),
      req.identity,
      req.id,
      key,
    );
  }
  @Get()
  @Permission("case:read")
  list(
    @Query() query: Record<string, string | undefined>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.list(req.identity, query);
  }
  @Get(":caseId")
  @Permission("case:read")
  get(@Param("caseId") id: string, @Req() req: AuthenticatedRequest) {
    return this.cases.get(id, req.identity);
  }
  @Patch(":caseId")
  @Permission("case:update")
  update(
    @Param("caseId") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.update(
      id,
      this.parse(updateCaseRequestSchema, body),
      req.identity,
      req.id,
    );
  }
  @Post(":caseId/parties")
  @Permission("case:update")
  party(
    @Param("caseId") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.addParty(
      id,
      this.parse(createCasePartyRequestSchema, body),
      req.identity,
      req.id,
    );
  }
  @Post(":caseId/assignments")
  @Permission("case:assign")
  assignment(
    @Param("caseId") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.addAssignment(
      id,
      this.parse(createCaseAssignmentRequestSchema, body),
      req.identity,
      req.id,
    );
  }
  @Delete(":caseId/assignments/:assignmentId")
  @Permission("case:assign")
  @HttpCode(204)
  remove(
    @Param("caseId") id: string,
    @Param("assignmentId") assignmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.removeAssignment(id, assignmentId, req.identity, req.id);
  }
  @Get(":caseId/timeline")
  @Permission("case:read")
  timeline(@Param("caseId") id: string, @Req() req: AuthenticatedRequest) {
    return this.cases.timeline(id, req.identity);
  }
  @Get(":caseId/evidence-references")
  @Permission("case:read")
  evidenceReferences(
    @Param("caseId") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.evidenceProjection(id, req.identity);
  }
  @Post(":caseId/cancel")
  @Permission("case:cancel")
  cancel(
    @Param("caseId") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const input = this.parse<{ version: number; reason: string }>(
      cancelCaseRequestSchema,
      body,
    );
    return this.cases.cancel(
      id,
      input.version,
      input.reason,
      req.identity,
      req.id,
    );
  }
  @Post(":caseId/external-references")
  @Permission("case:external-reference:manage")
  externalReference(
    @Param("caseId") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.addExternalReference(
      id,
      this.parse(createCaseExternalReferenceRequestSchema, body),
      req.identity,
    );
  }
  @Get(":caseId/external-references")
  @Permission("case:read")
  externalReferences(
    @Param("caseId") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.listExternalReferences(id, req.identity);
  }
  @Delete(":caseId/external-references/:referenceId")
  @Permission("case:external-reference:manage")
  @HttpCode(204)
  removeExternalReference(
    @Param("caseId") id: string,
    @Param("referenceId") referenceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.cases.removeExternalReference(id, referenceId, req.identity);
  }
}
