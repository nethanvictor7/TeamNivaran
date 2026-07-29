import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { getEnvironment } from "./environment.js";
import { CaseService } from "./case.service.js";

@Injectable()
export class InternalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const suppliedValue = context.switchToHttp().getRequest().headers[
      "x-cdep-internal-service-token"
    ];
    const supplied = Buffer.from(
      typeof suppliedValue === "string" ? suppliedValue : "",
    );
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

@Controller("internal/v1/cases")
@UseGuards(InternalServiceGuard)
export class InternalServiceController {
  constructor(private readonly cases: CaseService) {}
  @Post("resolve-correlation")
  resolve(@Body() body: any) {
    if (!body?.organizationId || !body?.ruleType || !body?.referenceValue)
      throw new BadRequestException("Invalid correlation request.");
    return this.cases.resolveCorrelation(body);
  }

  @Post("access-check")
  access(@Body() body: any) {
    if (!body?.organizationId || !body?.caseId)
      throw new BadRequestException("Invalid case access request.");
    return this.cases.internalAccessCheck(body.organizationId, body.caseId);
  }

  @Post("workflow-sync")
  sync(@Body() body: any) {
    if (
      !body?.organizationId ||
      !body?.caseId ||
      !body?.operationId ||
      !body?.targetStatus ||
      !body?.workflowInstanceId ||
      !body?.actorId
    )
      throw new BadRequestException(
        "Invalid Workflow synchronization request.",
      );
    return this.cases.internalWorkflowSync(body);
  }
}
