import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { resolveCaseExternalReferenceRequestSchema } from "@cdep/contracts";
import {
  AuthenticationGuard,
  type AuthenticatedRequest,
  Permission,
} from "./authentication.js";
import { CaseService } from "./case.service.js";
@Controller("internal/v1/cases")
@UseGuards(AuthenticationGuard)
export class InternalController {
  constructor(private readonly cases: CaseService) {}
  @Post("resolve-external-reference")
  @Permission("case:external-reference:resolve")
  resolve(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = resolveCaseExternalReferenceRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        "Invalid external reference resolution request.",
      );
    if (parsed.data.organizationId !== request.identity.organizationId)
      throw new BadRequestException("Organization scope mismatch.");
    return this.cases.resolveExternalReference(parsed.data);
  }
}
