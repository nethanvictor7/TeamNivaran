import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { FastifyReply } from "fastify";
import {
  AuthenticationGuard,
  type AuthenticatedRequest,
  Permission,
} from "./authentication.js";
import {
  EvidenceService,
  legalHoldSchema,
  relationshipSchema,
  updateMetadataSchema,
  uploadMetadataSchema,
} from "./evidence.service.js";

type MultipartRequest = AuthenticatedRequest & {
  file(options?: unknown): Promise<
    | {
        file: NodeJS.ReadableStream;
        filename: string;
        mimetype: string;
        fields: Record<string, { value?: unknown }>;
      }
    | undefined
  >;
};

function field(
  fields: Record<string, { value?: unknown }>,
  name: string,
): string | undefined {
  const value = fields[name]?.value;
  return typeof value === "string" ? value : undefined;
}

function parseUploadFields(
  fields: Record<string, { value?: unknown }>,
  assetId?: string,
) {
  const parsed = uploadMetadataSchema.safeParse({
    classificationCode: field(fields, "classificationCode"),
    title: field(fields, "title"),
    description: field(fields, "description") || undefined,
    externalReference: field(fields, "externalReference") || undefined,
    declaredSizeBytes: field(fields, "declaredSizeBytes"),
    reason: field(fields, "reason") || "INITIAL",
    ...(assetId ? { assetId } : {}),
  });
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  return parsed.data;
}

@Controller("api/v1")
@UseGuards(AuthenticationGuard)
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post("cases/:caseId/evidence")
  @HttpCode(202)
  @Permission("evidence:upload")
  async uploadInitial(
    @Param("caseId") caseId: string,
    @Req() request: MultipartRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const part = await request.file({
      limits: { files: 1, fields: 12, parts: 13 },
    });
    if (!part) throw new BadRequestException("An evidence file is required.");
    return this.evidence.uploadInitial(
      caseId,
      parseUploadFields(part.fields as any),
      {
        file: part.file as any,
        filename: part.filename,
        mimetype: part.mimetype,
      },
      request.identity,
      request.id,
      idempotencyKey ?? "",
    );
  }

  @Get("cases/:caseId/evidence")
  @Permission("evidence:read")
  listCase(
    @Param("caseId") caseId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evidence.listCase(caseId, request.identity, request.id, query);
  }

  @Get("evidence/classifications")
  @Permission("evidence:read")
  classifications(@Req() request: AuthenticatedRequest) {
    return this.evidence.classifications(request.identity);
  }

  @Get("evidence/:evidenceId")
  @Permission("evidence:read")
  get(@Param("evidenceId") id: string, @Req() request: AuthenticatedRequest) {
    return this.evidence.get(id, request.identity, request.id);
  }

  @Patch("evidence/:evidenceId")
  @Permission("evidence:metadata:update")
  update(
    @Param("evidenceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = updateMetadataSchema.safeParse(request.body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    return this.evidence.update(id, parsed.data, request.identity, request.id);
  }

  @Get("evidence/:evidenceId/versions")
  @Permission("evidence:read")
  versions(
    @Param("evidenceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evidence.versions(id, request.identity, request.id);
  }

  @Post("evidence/:evidenceId/versions")
  @HttpCode(202)
  @Permission("evidence:version:create")
  async uploadVersion(
    @Param("evidenceId") id: string,
    @Req() request: MultipartRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const part = await request.file({
      limits: { files: 1, fields: 12, parts: 13 },
    });
    if (!part) throw new BadRequestException("An evidence file is required.");
    return this.evidence.uploadVersion(
      id,
      parseUploadFields(part.fields as any, id),
      {
        file: part.file as any,
        filename: part.filename,
        mimetype: part.mimetype,
      },
      request.identity,
      request.id,
      idempotencyKey ?? "",
    );
  }

  @Get("evidence/:evidenceId/versions/:versionId")
  @Permission("evidence:read")
  version(
    @Param("evidenceId") id: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evidence.version(id, versionId, request.identity, request.id);
  }

  @Post("evidence/:evidenceId/versions/:versionId/download-grant")
  @HttpCode(200)
  @Permission("evidence:download")
  download(
    @Param("evidenceId") id: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evidence.downloadGrant(
      id,
      versionId,
      request.identity,
      request.id,
    );
  }

  @Get("evidence/:evidenceId/versions/:versionId/content")
  @Permission("evidence:download")
  async content(
    @Param("evidenceId") id: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ) {
    const content = await this.evidence.downloadContent(
      id,
      versionId,
      request.identity,
      request.id,
    );
    const filename = content.filename
      .replace(/[\u0000-\u001f\u007f"\\/\r\n]/g, "_")
      .slice(0, 180);
    void reply.header("content-type", content.mediaType);
    void reply.header(
      "content-disposition",
      `attachment; filename="${filename || "evidence"}"`,
    );
    void reply.header("cache-control", "no-store");
    if (content.sizeBytes != null)
      void reply.header("content-length", content.sizeBytes.toString());
    return reply.send(content.stream);
  }

  @Post("evidence/:evidenceId/versions/:versionId/integrity-checks")
  @HttpCode(202)
  @Permission("evidence:verify")
  integrity(
    @Param("evidenceId") id: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evidence.queueIntegrity(
      id,
      versionId,
      request.identity,
      request.id,
    );
  }

  @Get("evidence/:evidenceId/integrity-checks")
  @Permission("evidence:verify")
  integrityHistory(
    @Param("evidenceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evidence.integrityHistory(id, request.identity, request.id);
  }

  @Post("evidence/:evidenceId/relationships")
  @Permission("evidence:metadata:update")
  relationship(
    @Param("evidenceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = relationshipSchema.safeParse(request.body);
    if (!parsed.success)
      throw new BadRequestException("Invalid evidence relationship.");
    return this.evidence.addRelationship(
      id,
      parsed.data,
      request.identity,
      request.id,
    );
  }

  @Get("evidence/:evidenceId/lineage")
  @Permission("evidence:read")
  lineage(
    @Param("evidenceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evidence.lineage(id, request.identity, request.id);
  }

  @Post("evidence/:evidenceId/legal-holds")
  @Permission("evidence:hold")
  placeHold(
    @Param("evidenceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = legalHoldSchema.safeParse(request.body);
    if (!parsed.success)
      throw new BadRequestException("A legal-hold reason is required.");
    return this.evidence.placeHold(
      id,
      parsed.data.reason,
      request.identity,
      request.id,
    );
  }

  @Post("evidence/:evidenceId/legal-holds/:holdId/release")
  @Permission("evidence:hold")
  releaseHold(
    @Param("evidenceId") id: string,
    @Param("holdId") holdId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = legalHoldSchema.safeParse(request.body);
    if (!parsed.success)
      throw new BadRequestException("A legal-hold release reason is required.");
    return this.evidence.releaseHold(
      id,
      holdId,
      parsed.data.reason,
      request.identity,
      request.id,
    );
  }
}
