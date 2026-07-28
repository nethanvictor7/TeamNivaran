import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, Permission, type RequestIdentity } from "./auth.js";
import { IntegrationService } from "./integration.service.js";

@Controller("api/v1/integration")
@UseGuards(AuthGuard)
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}
  private identity(request: RequestIdentity) {
    return request.identity;
  }

  @Post("sources")
  @Permission("integration:source:manage")
  createSource(@Body() body: any, @Req() request: RequestIdentity) {
    return this.service.createSource(body, this.identity(request), request.id);
  }
  @Get("sources")
  @Permission("integration:source:read")
  sources(@Req() request: RequestIdentity) {
    return this.service.listSources(this.identity(request));
  }
  @Get("sources/:id")
  @Permission("integration:source:read")
  source(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.getSource(id, this.identity(request));
  }
  @Patch("sources/:id")
  @Permission("integration:source:manage")
  updateSource(
    @Param("id") id: string,
    @Body() body: any,
    @Req() request: RequestIdentity,
  ) {
    return this.service.updateSource(id, body, this.identity(request));
  }
  @Post("sources/:id/activate")
  @Permission("integration:source:manage")
  activateSource(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.sourceStatus(id, "ACTIVE", this.identity(request));
  }
  @Post("sources/:id/suspend")
  @Permission("integration:source:manage")
  suspendSource(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.sourceStatus(id, "SUSPENDED", this.identity(request));
  }

  @Post("sources/:sourceId/connectors")
  @Permission("integration:connector:manage")
  createConnector(
    @Param("sourceId") sourceId: string,
    @Body() body: any,
    @Req() request: RequestIdentity,
  ) {
    return this.service.createConnector(sourceId, body, this.identity(request));
  }
  @Get("sources/:sourceId/connectors")
  @Permission("integration:connector:read")
  connectors(
    @Param("sourceId") sourceId: string,
    @Req() request: RequestIdentity,
  ) {
    return this.service.listConnectors(sourceId, this.identity(request));
  }
  @Get("connectors/:id")
  @Permission("integration:connector:read")
  connector(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.getConnector(id, this.identity(request));
  }
  @Patch("connectors/:id")
  @Permission("integration:connector:manage")
  updateConnector(
    @Param("id") id: string,
    @Body() body: any,
    @Req() request: RequestIdentity,
  ) {
    return this.service.updateConnector(id, body, this.identity(request));
  }
  @Put("connectors/:id/credentials")
  @Permission("integration:connector:manage")
  credential(
    @Param("id") id: string,
    @Body() body: any,
    @Req() request: RequestIdentity,
  ) {
    return this.service.putCredential(id, body, this.identity(request));
  }
  @Post("connectors/:id/test")
  @Permission("integration:connector:test")
  testConnector(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.testConnector(id, this.identity(request));
  }
  @Post("connectors/:id/activate")
  @Permission("integration:connector:manage")
  activateConnector(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.connectorStatus(id, "ACTIVE", this.identity(request));
  }
  @Post("connectors/:id/pause")
  @Permission("integration:connector:manage")
  pauseConnector(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.connectorStatus(id, "PAUSED", this.identity(request));
  }
  @Post("connectors/:id/run")
  @Permission("integration:connector:run")
  runConnector(
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: RequestIdentity,
  ) {
    return this.service.runConnector(id, key, this.identity(request));
  }

  @Get("connectors/:id/extraction-rules")
  @Permission("integration:connector:read")
  extractionRules(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.getExtractionRules(id, this.identity(request));
  }
  @Put("connectors/:id/extraction-rules")
  @Permission("integration:connector:manage")
  putExtractionRules(
    @Param("id") id: string,
    @Body() body: any,
    @Req() request: RequestIdentity,
  ) {
    return this.service.putExtractionRules(
      id,
      body.rules ?? body,
      this.identity(request),
    );
  }
  @Post("connectors/:id/test-extraction")
  @Permission("integration:connector:test")
  testExtraction(
    @Param("id") id: string,
    @Body() body: any,
    @Req() request: RequestIdentity,
  ) {
    if (body?.sample === undefined)
      throw new BadRequestException("A sample payload is required.");
    return this.service.testExtraction(id, body.sample, this.identity(request));
  }
  @Get("connectors/:id/correlation-rules")
  @Permission("integration:connector:read")
  correlationRules(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.getCorrelationRules(id, this.identity(request));
  }
  @Put("connectors/:id/correlation-rules")
  @Permission("integration:connector:manage")
  putCorrelationRules(
    @Param("id") id: string,
    @Body() body: any,
    @Req() request: RequestIdentity,
  ) {
    return this.service.putCorrelationRules(id, body, this.identity(request));
  }

  @Get("triggers")
  @Permission("integration:trigger:read")
  triggers(@Query() query: any, @Req() request: RequestIdentity) {
    return this.service.listTriggers(this.identity(request), query);
  }
  @Get("triggers/:id")
  @Permission("integration:trigger:read")
  trigger(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.getTrigger(id, this.identity(request));
  }
  @Get("triggers/:id/payload")
  @Permission("integration:trigger:read")
  payload(
    @Param("id") id: string,
    @Headers("x-cdep-access-reason") reason: string | undefined,
    @Req() request: RequestIdentity,
  ) {
    return this.service.getPayload(
      id,
      reason,
      this.identity(request),
      request.id,
    );
  }
  @Get("runs")
  @Permission("integration:connector:read")
  runs(@Query() query: any, @Req() request: RequestIdentity) {
    return this.service.listRuns(this.identity(request), query);
  }
  @Get("runs/:id")
  @Permission("integration:connector:read")
  run(@Param("id") id: string, @Req() request: RequestIdentity) {
    return this.service.getRun(id, this.identity(request));
  }
  @Post("triggers/:id/replay")
  @Permission("integration:replay")
  replay(
    @Param("id") id: string,
    @Body() body: any,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: RequestIdentity,
  ) {
    return this.service.replay(id, body.reason, key, this.identity(request));
  }
  @Post("triggers/:id/resolve-case")
  @Permission("integration:correlation:resolve")
  resolve(
    @Param("id") id: string,
    @Body() body: any,
    @Headers("authorization") bearer: string | undefined,
    @Req() request: RequestIdentity,
  ) {
    return this.service.resolveCase(id, body, bearer, this.identity(request));
  }
  @Get("cases/:caseId/journey")
  @Permission("integration:journey:read")
  journey(@Param("caseId") caseId: string, @Req() request: RequestIdentity) {
    return this.service.journey(caseId, this.identity(request));
  }
}
