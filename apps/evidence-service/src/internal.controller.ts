import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { getEnvironment } from "./environment.js";
import { EvidenceService } from "./evidence.service.js";

@Injectable()
export class EvidenceInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const suppliedHeader = context.switchToHttp().getRequest().headers[
      "x-cdep-internal-service-token"
    ];
    const supplied = Buffer.from(
      typeof suppliedHeader === "string" ? suppliedHeader : "",
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

@Controller("internal/v1/evidence")
@UseGuards(EvidenceInternalGuard)
export class EvidenceInternalController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post("case-snapshot")
  snapshot(@Body() body: Record<string, unknown>) {
    if (
      typeof body.organizationId !== "string" ||
      typeof body.caseId !== "string"
    )
      throw new BadRequestException("Invalid Evidence snapshot request.");
    return this.evidence.internalCaseSnapshot(body.organizationId, body.caseId);
  }

  @Post("version-content")
  async content(
    @Body() body: Record<string, unknown>,
    @Res() reply: FastifyReply,
  ) {
    const keys = [
      "organizationId",
      "caseId",
      "evidenceAssetId",
      "evidenceVersionId",
      "expectedSha256",
    ] as const;
    if (keys.some((key) => typeof body[key] !== "string"))
      throw new BadRequestException("Invalid Evidence content request.");
    const content = await this.evidence.internalVersionContent({
      organizationId: body.organizationId as string,
      caseId: body.caseId as string,
      evidenceAssetId: body.evidenceAssetId as string,
      evidenceVersionId: body.evidenceVersionId as string,
      expectedSha256: body.expectedSha256 as string,
    });
    void reply.header("content-type", content.mediaType);
    void reply.header("x-content-sha256", content.sha256);
    void reply.header(
      "x-evidence-version-id",
      body.evidenceVersionId as string,
    );
    if (content.sizeBytes)
      void reply.header("content-length", content.sizeBytes.toString());
    return reply.send(content.stream);
  }

  @Post("proof-snapshot")
  proofSnapshot(@Body() body: Record<string, unknown>) {
    if (
      typeof body.organizationId !== "string" ||
      typeof body.evidenceAssetId !== "string" ||
      typeof body.evidenceVersionId !== "string"
    )
      throw new BadRequestException("Invalid Evidence proof request.");
    return this.evidence.internalProofSnapshot(
      body.organizationId,
      body.evidenceAssetId,
      body.evidenceVersionId,
    );
  }
}
