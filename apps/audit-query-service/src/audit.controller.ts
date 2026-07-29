import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "./audit.service.js";
import {
  AuthenticationGuard,
  type AuthenticatedRequest,
  Permission,
} from "./authentication.js";

function uuid(value: string) {
  return z.uuid().parse(value);
}

@Controller("api/v1/audit")
@UseGuards(AuthenticationGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("records")
  @Permission("audit:search")
  search(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.audit.search(request.identity, query);
  }

  @Get("records/:auditId")
  @Permission("audit:detail")
  detail(
    @Param("auditId") auditId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.detail(request.identity, uuid(auditId));
  }

  @Get("cases/:caseId/journey")
  @Permission("audit:journey")
  journey(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.journey(request.identity, uuid(caseId));
  }

  @Get("chain/verify")
  @Permission("audit:verify")
  verify(
    @Query("limit") limit: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.verifyChain(
      request.identity,
      limit ? Number(limit) : 500,
    );
  }

  @Get("reports/catalog")
  @Permission("report:run")
  catalog() {
    return this.audit.reportCatalog();
  }

  @Get("reports")
  @Permission("report:run")
  reports(@Req() request: AuthenticatedRequest) {
    return this.audit.reports(request.identity);
  }

  @Post("reports")
  @HttpCode(202)
  @Permission("report:run")
  createReport(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.createReport(
      request.identity,
      body,
      key ?? "",
      request.id,
    );
  }

  @Get("reports/:runId")
  @Permission("report:run")
  report(@Param("runId") runId: string, @Req() request: AuthenticatedRequest) {
    return this.audit.report(request.identity, uuid(runId));
  }

  @Get("reports/:runId/download")
  @Permission("artifact:download")
  reportDownload(
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.reportDownload(request.identity, uuid(runId), request.id);
  }

  @Get("exports")
  @Permission("export:request")
  exports(@Req() request: AuthenticatedRequest) {
    return this.audit.exports(request.identity);
  }

  @Post("exports")
  @HttpCode(202)
  @Permission("export:request")
  createExport(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.createExport(
      request.identity,
      body,
      key ?? "",
      request.id,
    );
  }

  @Get("exports/:runId")
  @Permission("export:request")
  export(@Param("runId") runId: string, @Req() request: AuthenticatedRequest) {
    return this.audit.export(request.identity, uuid(runId));
  }

  @Post("exports/:runId/cancel")
  @Permission("export:request")
  cancelExport(
    @Param("runId") runId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.cancelExport(
      request.identity,
      uuid(runId),
      key ?? "",
      request.id,
    );
  }

  @Get("exports/:runId/download")
  @Permission("artifact:download")
  exportDownload(
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.exportDownload(request.identity, uuid(runId), request.id);
  }

  @Get("operations")
  @Permission("audit:operations")
  operations(@Req() request: AuthenticatedRequest) {
    return this.audit.operations(request.identity);
  }

  @Post("operations")
  @HttpCode(202)
  @Permission("audit:operate")
  operation(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.audit.createOperation(
      request.identity,
      body,
      key ?? "",
      request.id,
    );
  }
}
