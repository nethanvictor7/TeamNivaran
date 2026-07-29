import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type {
  EvidenceAsset,
  EvidenceVersion,
  Prisma,
} from "@cdep/evidence-prisma-client";
import { fileTypeStream } from "file-type";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { basename, extname } from "node:path";
import { Transform, type Readable } from "node:stream";
import { z } from "zod";
import type { EvidenceIdentity } from "./authentication.js";
import { CaseAccessService } from "./case-access.service.js";
import { getEnvironment } from "./environment.js";
import {
  type EvidenceObjectStorage,
  S3EvidenceObjectStorage,
} from "./object-storage.js";
import { PrismaService } from "./prisma.service.js";

const classifications = [
  "IDENTITY",
  "INCOME",
  "BANK_STATEMENT",
  "CREDIT_REPORT",
  "APPLICATION_FORM",
  "COLLATERAL",
  "CORRESPONDENCE",
  "DECISION_RECORD",
  "OTHER",
] as const;

export const uploadMetadataSchema = z.object({
  classificationCode: z.enum(classifications),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2000).optional(),
  externalReference: z.string().trim().max(240).optional(),
  declaredSizeBytes: z.coerce.number().int().positive(),
  assetId: z.uuid().optional(),
  reason: z
    .enum(["INITIAL", "CORRECTION", "REPLACEMENT", "DERIVED"])
    .default("INITIAL"),
});

export const updateMetadataSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    classificationCode: z.enum(classifications).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    externalReference: z.string().trim().max(240).nullable().optional(),
    retentionPolicyCode: z.string().trim().max(80).nullable().optional(),
  })
  .strict();

export const relationshipSchema = z.object({
  relatedEvidenceId: z.uuid(),
  relationshipType: z.enum([
    "CORRECTS",
    "REPLACES",
    "DERIVED_FROM",
    "SUPPORTS",
    "RELATED_TO",
  ]),
});

export const legalHoldSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

type UploadPart = {
  filename: string;
  mimetype: string;
  file: Readable;
};

class HashingTransform extends Transform {
  private readonly hash = createHash("sha256");
  private completed = false;
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    this.hash.update(chunk);
    callback(null, chunk);
  }
  digest() {
    if (this.completed) throw new Error("HASH_ALREADY_FINALIZED");
    this.completed = true;
    return this.hash.digest("hex");
  }
}

class PlainTextValidationTransform extends Transform {
  private total = 0;
  private unsafe = 0;
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    for (const byte of chunk.subarray(0, Math.max(0, 8192 - this.total))) {
      this.total += 1;
      if (byte === 0 || byte < 9 || (byte > 13 && byte < 32) || byte === 127)
        this.unsafe += 1;
    }
    callback(null, chunk);
  }
  isPlainText() {
    return this.total > 0 && this.unsafe / this.total < 0.01;
  }
}

export function sanitizeFilename(filename: string) {
  if (
    !filename ||
    filename !== basename(filename) ||
    /[\u0000-\u001f\u007f\\/]/.test(filename)
  ) {
    throw new BadRequestException("The evidence filename is not safe.");
  }
  const cleaned = filename
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} ._()\-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!cleaned) throw new BadRequestException("The filename is empty.");
  return cleaned;
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class EvidenceService {
  private readonly environment = getEnvironment();
  constructor(
    private readonly prisma: PrismaService,
    private readonly cases: CaseAccessService,
    private readonly storage: S3EvidenceObjectStorage,
  ) {}

  async internalCaseSnapshot(organizationId: string, caseId: string) {
    const assets = await this.prisma.evidenceAsset.findMany({
      where: { organizationId, primaryCaseId: caseId },
      orderBy: [{ classificationCode: "asc" }, { id: "asc" }],
    });
    const versions = assets.length
      ? await this.prisma.evidenceVersion.findMany({
          where: {
            organizationId,
            id: {
              in: assets
                .map((asset) => asset.currentVersionId)
                .filter((id): id is string => Boolean(id)),
            },
          },
        })
      : [];
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );
    const scans = versions.length
      ? await this.prisma.malwareScanAttempt.findMany({
          where: {
            organizationId,
            evidenceVersionId: { in: versions.map((version) => version.id) },
          },
          orderBy: [{ evidenceVersionId: "asc" }, { attemptNumber: "desc" }],
        })
      : [];
    const scanByVersion = new Map<string, (typeof scans)[number]>();
    for (const scan of scans)
      if (!scanByVersion.has(scan.evidenceVersionId))
        scanByVersion.set(scan.evidenceVersionId, scan);
    return {
      organizationId,
      caseId,
      snapshotAt: new Date().toISOString(),
      items: assets.flatMap((asset) => {
        const version = asset.currentVersionId
          ? versionById.get(asset.currentVersionId)
          : undefined;
        if (!version || !version.sha256 || !version.availableAt) return [];
        const scan = scanByVersion.get(version.id);
        return [
          {
            evidenceAssetId: asset.id,
            evidenceVersionId: version.id,
            sha256: version.sha256,
            classificationCode: asset.classificationCode,
            evidenceStatus: asset.status,
            processingStatus: version.processingStatus,
            malwareStatus: scan?.status ?? "ERROR",
            authoritative: asset.currentVersionId === version.id,
            availableAt: version.availableAt.toISOString(),
            createdById: version.createdById,
            mimeType: version.detectedMediaType,
            sizeBytes: version.sizeBytes?.toString() ?? null,
          },
        ];
      }),
    };
  }

  async internalVersionContent(input: {
    organizationId: string;
    caseId: string;
    evidenceAssetId: string;
    evidenceVersionId: string;
    expectedSha256: string;
  }) {
    const asset = await this.prisma.evidenceAsset.findFirst({
      where: {
        id: input.evidenceAssetId,
        organizationId: input.organizationId,
        primaryCaseId: input.caseId,
        status: { in: ["ACTIVE", "ON_HOLD", "ARCHIVED"] },
      },
    });
    if (!asset)
      throw new NotFoundException(
        "Authoritative Evidence asset version not found.",
      );
    const version = await this.prisma.evidenceVersion.findFirst({
      where: {
        id: input.evidenceVersionId,
        evidenceAssetId: asset.id,
        organizationId: input.organizationId,
        processingStatus: "AVAILABLE",
        sha256: input.expectedSha256,
      },
    });
    if (!version?.canonicalBucket || !version.canonicalKey || !version.sha256)
      throw new NotFoundException(
        "Available canonical Evidence content not found.",
      );
    return {
      stream: await this.storage.getObjectStream({
        bucket: version.canonicalBucket,
        key: version.canonicalKey,
      }),
      mediaType: version.detectedMediaType ?? "application/octet-stream",
      sizeBytes: version.sizeBytes,
      sha256: version.sha256,
      filename: version.displayFilename,
    };
  }

  async internalProofSnapshot(
    organizationId: string,
    evidenceAssetId: string,
    evidenceVersionId: string,
  ) {
    const asset = await this.prisma.evidenceAsset.findFirst({
      where: {
        id: evidenceAssetId,
        organizationId,
        status: { in: ["ACTIVE", "ON_HOLD", "ARCHIVED"] },
      },
    });
    if (!asset) throw new NotFoundException("Evidence version not found.");
    const version = await this.prisma.evidenceVersion.findFirst({
      where: {
        id: evidenceVersionId,
        evidenceAssetId,
        organizationId,
        processingStatus: "AVAILABLE",
        sha256: { not: null },
        availableAt: { not: null },
      },
    });
    if (!version?.sha256 || !version.availableAt)
      throw new NotFoundException("Available Evidence version not found.");
    const scan = await this.prisma.malwareScanAttempt.findFirst({
      where: { organizationId, evidenceVersionId },
      orderBy: { attemptNumber: "desc" },
    });
    if (scan?.status !== "CLEAN")
      throw new ConflictException(
        "Only a clean Evidence version can be anchored.",
      );
    return {
      organizationId,
      caseId: asset.primaryCaseId,
      evidenceAssetId,
      evidenceVersionId,
      versionNumber: version.versionNumber,
      previousVersionId: version.previousVersionId,
      sha256: version.sha256,
      classificationCode: asset.classificationCode,
      processingStatus: version.processingStatus,
      malwareStatus: scan.status,
      authoritative: asset.currentVersionId === version.id,
      availableAt: version.availableAt.toISOString(),
      mediaType: version.detectedMediaType,
      sizeBytes: version.sizeBytes?.toString() ?? null,
    };
  }

  async uploadInitial(
    caseId: string,
    metadata: z.infer<typeof uploadMetadataSchema>,
    part: UploadPart,
    identity: EvidenceIdentity,
    correlationId: string,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new BadRequestException("A valid Idempotency-Key is required.");
    if (metadata.assetId)
      throw new BadRequestException(
        "assetId is only valid when adding content to an existing asset.",
      );
    await this.cases.assertAccessible(
      caseId,
      identity.organizationId,
      correlationId,
    );
    await this.assertClassification(
      metadata.classificationCode,
      identity.organizationId,
    );
    return this.upload({
      caseId,
      metadata,
      part,
      identity,
      correlationId,
      idempotencyKey,
      operation: "CREATE_ASSET",
    });
  }

  async uploadVersion(
    assetId: string,
    metadata: z.infer<typeof uploadMetadataSchema>,
    part: UploadPart,
    identity: EvidenceIdentity,
    correlationId: string,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new BadRequestException("A valid Idempotency-Key is required.");
    const asset = await this.assetOr404(assetId, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    if (asset.latestVersionNumber === 0 && metadata.reason !== "INITIAL")
      throw new ConflictException(
        "The first content version must use reason INITIAL.",
      );
    if (asset.latestVersionNumber > 0 && metadata.reason === "INITIAL")
      throw new ConflictException(
        "A subsequent version must be a correction or replacement.",
      );
    return this.upload({
      caseId: asset.primaryCaseId,
      metadata: {
        ...metadata,
        assetId,
        classificationCode: asset.classificationCode as any,
        title: asset.title,
      },
      part,
      identity,
      correlationId,
      idempotencyKey,
      operation: `CREATE_VERSION:${assetId}`,
    });
  }

  private async upload(input: {
    caseId: string;
    metadata: z.infer<typeof uploadMetadataSchema>;
    part: UploadPart;
    identity: EvidenceIdentity;
    correlationId: string;
    idempotencyKey: string;
    operation: string;
  }) {
    if (
      input.metadata.declaredSizeBytes >
      this.environment.EVIDENCE_MAX_UPLOAD_BYTES
    )
      throw new PayloadTooLargeException(
        `Evidence exceeds the ${this.environment.EVIDENCE_MAX_UPLOAD_BYTES} byte limit.`,
      );
    const displayFilename = sanitizeFilename(input.part.filename);
    const requestFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          caseId: input.caseId,
          assetId: input.metadata.assetId,
          classificationCode: input.metadata.classificationCode,
          title: input.metadata.title,
          description: input.metadata.description,
          externalReference: input.metadata.externalReference,
          reason: input.metadata.reason,
          filename: displayFilename,
          declaredSizeBytes: input.metadata.declaredSizeBytes,
          declaredMediaType: input.part.mimetype,
        }),
      )
      .digest("hex");
    const prior = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_idempotencyKey_operation: {
          organizationId: input.identity.organizationId,
          idempotencyKey: input.idempotencyKey,
          operation: input.operation,
        },
      },
    });
    if (prior) {
      if (prior.requestHash !== requestFingerprint)
        throw new ConflictException(
          "Idempotency key was used for a different upload.",
        );
      input.part.file.resume();
      return prior.responseBody;
    }

    const detected = await fileTypeStream(input.part.file);
    let detectedMediaType = detected.fileType?.mime.toLowerCase();
    const declaredMediaType = input.part.mimetype?.toLowerCase();
    const extension = extname(displayFilename).toLowerCase();
    let textValidator: PlainTextValidationTransform | undefined;
    let contentStream: Readable = detected;
    if (
      !detectedMediaType &&
      declaredMediaType === "text/plain" &&
      extension === ".txt"
    ) {
      detectedMediaType = "text/plain";
      textValidator = new PlainTextValidationTransform();
      contentStream = contentStream.pipe(textValidator);
    }
    if (
      !detectedMediaType ||
      !this.environment.EVIDENCE_ALLOWED_MEDIA_TYPES.has(detectedMediaType)
    ) {
      contentStream.destroy();
      throw new UnsupportedMediaTypeException(
        "The detected evidence media type is not allowed.",
      );
    }
    if (
      declaredMediaType &&
      declaredMediaType !== "application/octet-stream" &&
      declaredMediaType !== detectedMediaType
    ) {
      contentStream.destroy();
      throw new UnsupportedMediaTypeException(
        "The declared and detected media types do not match.",
      );
    }

    const quarantineKey = `quarantine/${randomUUID()}`;
    const canonicalKey = `canonical/${randomUUID()}`;
    let prepared:
      | {
          asset: EvidenceAsset;
          version: EvidenceVersion;
          uploadSessionId: string;
        }
      | undefined;
    try {
      prepared = await this.prepareUpload(
        input,
        displayFilename,
        declaredMediaType,
        detectedMediaType,
        quarantineKey,
        canonicalKey,
      );
      const hasher = new HashingTransform();
      const stored = await this.storage.putQuarantineObject({
        key: quarantineKey,
        body: contentStream.pipe(hasher),
        contentType: detectedMediaType,
        expectedMaxBytes: this.environment.EVIDENCE_MAX_UPLOAD_BYTES,
      });
      if (textValidator && !textValidator.isPlainText())
        throw new UnsupportedMediaTypeException(
          "The file content is not valid plain text.",
        );
      if (stored.sizeBytes !== input.metadata.declaredSizeBytes)
        throw new BadRequestException(
          "The declared evidence size does not match the uploaded bytes.",
        );
      const sha256 = hasher.digest();
      const response = await this.prisma.$transaction(async (tx) => {
        const version = await tx.evidenceVersion.update({
          where: { id: prepared!.version.id },
          data: {
            processingStatus: "UPLOADED",
            quarantineBucket: stored.bucket,
            quarantineKey: stored.key,
            sizeBytes: BigInt(stored.sizeBytes),
            sha256,
            ...(stored.providerVersionId
              ? { objectVersionId: stored.providerVersionId }
              : {}),
          },
        });
        await tx.evidenceUploadSession.update({
          where: { id: prepared!.uploadSessionId },
          data: {
            status: "COMPLETED",
            bytesReceived: BigInt(stored.sizeBytes),
            completedAt: new Date(),
          },
        });
        await tx.evidenceProcessingJob.create({
          data: {
            organizationId: input.identity.organizationId,
            evidenceAssetId: prepared!.asset.id,
            evidenceVersionId: version.id,
            jobType: "MALWARE_SCAN",
            maxAttempts: this.environment.EVIDENCE_PROCESSING_MAX_ATTEMPTS,
            correlationId: input.correlationId,
          },
        });
        await this.event(tx, {
          asset: prepared!.asset,
          version,
          identity: input.identity,
          correlationId: input.correlationId,
          eventType: "evidence.version.uploaded",
          payload: {
            evidenceNumber: prepared!.asset.evidenceNumber,
            caseId: input.caseId,
            versionId: version.id,
            versionNumber: version.versionNumber,
            classificationCode: prepared!.asset.classificationCode,
            evidenceStatus: "PROCESSING",
            sourceType: prepared!.asset.sourceType,
          },
        });
        const result = this.serializeAsset(prepared!.asset, version);
        await tx.idempotencyRecord.create({
          data: {
            organizationId: input.identity.organizationId,
            idempotencyKey: input.idempotencyKey,
            operation: input.operation,
            requestHash: requestFingerprint,
            responseStatus: 202,
            responseBody: jsonSafe(result),
          },
        });
        return result;
      });
      return response;
    } catch (error) {
      if (prepared) {
        await this.markUploadFailure(
          prepared,
          quarantineKey,
          error instanceof PayloadTooLargeException ||
            (error instanceof Error &&
              error.message === "UPLOAD_SIZE_LIMIT_EXCEEDED")
            ? "UPLOAD_TOO_LARGE"
            : error instanceof UnsupportedMediaTypeException
              ? "UNSUPPORTED_MEDIA_TYPE"
              : "UPLOAD_FAILED",
        );
      }
      if (error instanceof HttpException || error instanceof ConflictException)
        throw error;
      if (
        error instanceof Error &&
        error.message === "UPLOAD_SIZE_LIMIT_EXCEEDED"
      )
        throw new PayloadTooLargeException(
          "The upload exceeded the configured byte limit.",
        );
      throw new ServiceUnavailableException(
        "The upload could not be durably quarantined.",
      );
    }
  }

  private async prepareUpload(
    input: {
      caseId: string;
      metadata: z.infer<typeof uploadMetadataSchema>;
      identity: EvidenceIdentity;
      correlationId: string;
    },
    displayFilename: string,
    declaredMediaType: string | undefined,
    detectedMediaType: string,
    quarantineKey: string,
    canonicalKey: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      let asset: EvidenceAsset;
      if (input.metadata.assetId) {
        const current = await tx.evidenceAsset.findFirst({
          where: {
            id: input.metadata.assetId,
            organizationId: input.identity.organizationId,
          },
        });
        if (!current) throw new NotFoundException("Evidence not found.");
        const updated = await tx.evidenceAsset.update({
          where: { id: current.id },
          data: {
            latestVersionNumber: { increment: 1 },
            status: "PROCESSING",
            rowVersion: { increment: 1 },
            updatedBy: input.identity.userId,
          },
        });
        asset = updated;
      } else {
        const sequence = await tx.$queryRaw<Array<{ value: bigint }>>`
          SELECT nextval('evidence_number_seq') AS value
        `;
        const value = sequence[0]?.value;
        if (value === undefined)
          throw new Error("Evidence number allocation failed.");
        asset = await tx.evidenceAsset.create({
          data: {
            organizationId: input.identity.organizationId,
            evidenceNumber: `EV-${new Date()
              .getUTCFullYear()
              .toString()}-${value.toString().padStart(7, "0")}`,
            primaryCaseId: input.caseId,
            classificationCode: input.metadata.classificationCode,
            title: input.metadata.title,
            ...(input.metadata.description
              ? { description: input.metadata.description }
              : {}),
            ...(input.metadata.externalReference
              ? { externalReference: input.metadata.externalReference }
              : {}),
            sourceType: "USER_UPLOAD",
            status: "PROCESSING",
            latestVersionNumber: 1,
            createdByType: "USER",
            createdById: input.identity.userId,
            updatedBy: input.identity.userId,
          },
        });
        await tx.evidenceCaseLink.create({
          data: {
            organizationId: input.identity.organizationId,
            evidenceAssetId: asset.id,
            caseId: input.caseId,
            linkedBy: input.identity.userId,
          },
        });
        await this.event(tx, {
          asset,
          identity: input.identity,
          correlationId: input.correlationId,
          eventType: "evidence.asset.created",
          payload: {
            evidenceNumber: asset.evidenceNumber,
            caseId: input.caseId,
            classificationCode: asset.classificationCode,
            evidenceStatus: asset.status,
            sourceType: asset.sourceType,
          },
        });
      }
      const previous =
        asset.latestVersionNumber > 1
          ? await tx.evidenceVersion.findFirst({
              where: {
                evidenceAssetId: asset.id,
                versionNumber: asset.latestVersionNumber - 1,
              },
            })
          : null;
      if (asset.latestVersionNumber > 1 && (!previous || !previous.sha256))
        throw new ConflictException(
          "The previous immutable version is not available for lineage.",
        );
      const version = await tx.evidenceVersion.create({
        data: {
          organizationId: input.identity.organizationId,
          evidenceAssetId: asset.id,
          versionNumber: asset.latestVersionNumber,
          previousVersionId: previous?.id ?? null,
          previousSha256: previous?.sha256 ?? null,
          processingStatus: "UPLOAD_PENDING",
          quarantineKey,
          canonicalKey,
          originalFilename: displayFilename,
          displayFilename,
          declaredMediaType: declaredMediaType ?? null,
          detectedMediaType,
          createdReason: input.metadata.reason,
          metadataJson: {},
          createdByType: "USER",
          createdById: input.identity.userId,
        },
      });
      const session = await tx.evidenceUploadSession.create({
        data: {
          organizationId: input.identity.organizationId,
          evidenceAssetId: asset.id,
          evidenceVersionId: version.id,
          declaredSizeBytes: BigInt(input.metadata.declaredSizeBytes),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          correlationId: input.correlationId,
        },
      });
      return { asset, version, uploadSessionId: session.id };
    });
  }

  private async markUploadFailure(
    prepared: {
      asset: EvidenceAsset;
      version: EvidenceVersion;
      uploadSessionId: string;
    },
    quarantineKey: string,
    failureCode: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.evidenceVersion.updateMany({
        where: {
          id: prepared.version.id,
          processingStatus: { in: ["UPLOAD_PENDING", "UPLOADED"] },
        },
        data: {
          processingStatus: "FAILED",
          failureCode,
          failureDetailSanitized: "Evidence intake did not complete.",
        },
      });
      await tx.evidenceUploadSession.updateMany({
        where: { id: prepared.uploadSessionId, status: "OPEN" },
        data: { status: "FAILED", failureCode },
      });
      await tx.evidenceAsset.update({
        where: { id: prepared.asset.id },
        data: {
          status: prepared.asset.currentVersionId ? "ACTIVE" : "REJECTED",
          updatedBy: "system",
        },
      });
      await tx.orphanObjectCandidate.upsert({
        where: {
          bucket_objectKey_kind: {
            bucket: this.environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
            objectKey: quarantineKey,
            kind: "QUARANTINE",
          },
        },
        update: {},
        create: {
          organizationId: prepared.asset.organizationId,
          evidenceVersionId: prepared.version.id,
          bucket: this.environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
          objectKey: quarantineKey,
          kind: "QUARANTINE",
          eligibleAfter: new Date(
            Date.now() +
              this.environment.EVIDENCE_ORPHAN_SAFETY_PERIOD_HOURS *
                60 *
                60 *
                1000,
          ),
          detailSanitized: "Interrupted or rejected quarantine upload.",
        },
      });
    });
  }

  async listCase(
    caseId: string,
    identity: EvidenceIdentity,
    correlationId: string,
    query: Record<string, string | undefined>,
  ) {
    await this.cases.assertAccessible(
      caseId,
      identity.organizationId,
      correlationId,
    );
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where: Prisma.EvidenceAssetWhereInput = {
      organizationId: identity.organizationId,
      primaryCaseId: caseId,
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.classification
        ? { classificationCode: query.classification }
        : {}),
      ...(query.source ? { sourceType: query.source as any } : {}),
      ...(query.search
        ? {
            OR: [
              {
                evidenceNumber: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              { title: { contains: query.search, mode: "insensitive" } },
              {
                externalReference: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.evidenceAsset.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.evidenceAsset.count({ where }),
    ]);
    const statuses = await this.prisma.$queryRaw<
      Array<{ status: string; count: bigint }>
    >`
      SELECT status::text, COUNT(*)::bigint AS count
      FROM evidence_assets
      WHERE organization_id = ${identity.organizationId}::uuid
        AND primary_case_id = ${caseId}::uuid
      GROUP BY status
      ORDER BY status
    `;
    const classes = await this.prisma.$queryRaw<
      Array<{ classification_code: string; count: bigint }>
    >`
      SELECT classification_code, COUNT(*)::bigint AS count
      FROM evidence_assets
      WHERE organization_id = ${identity.organizationId}::uuid
        AND primary_case_id = ${caseId}::uuid
      GROUP BY classification_code
      ORDER BY classification_code
    `;
    return {
      items: items.map((item) => this.serializeAsset(item)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      summary: {
        byStatus: Object.fromEntries(
          statuses.map((item) => [item.status, Number(item.count)]),
        ),
        byClassification: Object.fromEntries(
          classes.map((item) => [item.classification_code, Number(item.count)]),
        ),
      },
    };
  }

  async get(id: string, identity: EvidenceIdentity, correlationId: string) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const current = asset.currentVersionId
      ? await this.prisma.evidenceVersion.findFirst({
          where: {
            id: asset.currentVersionId,
            organizationId: identity.organizationId,
          },
        })
      : null;
    const activeHold = await this.activeHold(asset.id, identity.organizationId);
    return {
      ...this.serializeAsset(asset, current),
      activeLegalHold: activeHold
        ? {
            id: activeHold.id,
            reason: activeHold.reason,
            actedAt: activeHold.actedAt.toISOString(),
          }
        : null,
    };
  }

  async update(
    id: string,
    input: z.infer<typeof updateMetadataSchema>,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    if (input.classificationCode)
      await this.assertClassification(
        input.classificationCode,
        identity.organizationId,
      );
    const { rowVersion } = input;
    const updates: Prisma.EvidenceAssetUpdateManyMutationInput = {
      ...(input.classificationCode
        ? { classificationCode: input.classificationCode }
        : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.externalReference !== undefined
        ? { externalReference: input.externalReference }
        : {}),
      ...(input.retentionPolicyCode !== undefined
        ? { retentionPolicyCode: input.retentionPolicyCode }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const written = await tx.evidenceAsset.updateMany({
        where: {
          id,
          organizationId: identity.organizationId,
          rowVersion,
        },
        data: {
          ...updates,
          rowVersion: { increment: 1 },
          updatedBy: identity.userId,
        },
      });
      if (written.count !== 1)
        throw new ConflictException(
          "Evidence metadata was changed by another user.",
        );
      const updated = await tx.evidenceAsset.findUniqueOrThrow({
        where: { id },
      });
      await this.event(tx, {
        asset: updated,
        identity,
        correlationId,
        eventType: "evidence.asset.metadata.updated",
        payload: {
          evidenceNumber: updated.evidenceNumber,
          caseId: updated.primaryCaseId,
          classificationCode: updated.classificationCode,
          evidenceStatus: updated.status,
          sourceType: updated.sourceType,
        },
      });
      return this.serializeAsset(updated);
    });
  }

  async versions(
    id: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const versions = await this.prisma.evidenceVersion.findMany({
      where: {
        evidenceAssetId: id,
        organizationId: identity.organizationId,
      },
      orderBy: { versionNumber: "desc" },
    });
    return versions.map((version) => this.serializeVersion(version));
  }

  async version(
    id: string,
    versionId: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const version = await this.prisma.evidenceVersion.findFirst({
      where: {
        id: versionId,
        evidenceAssetId: id,
        organizationId: identity.organizationId,
      },
    });
    if (!version) throw new NotFoundException("Evidence version not found.");
    return this.serializeVersion(version);
  }

  async downloadGrant(
    id: string,
    versionId: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const version = await this.prisma.evidenceVersion.findFirst({
      where: {
        id: versionId,
        evidenceAssetId: id,
        organizationId: identity.organizationId,
      },
    });
    const allowed =
      version?.processingStatus === "AVAILABLE" &&
      Boolean(version.canonicalBucket && version.canonicalKey);
    await this.prisma.evidenceAccessRecord.create({
      data: {
        organizationId: identity.organizationId,
        evidenceAssetId: id,
        evidenceVersionId: versionId,
        actorId: identity.userId,
        action: "DOWNLOAD_GRANT",
        outcome: allowed ? "GRANTED" : "DENIED",
        reasonCode: allowed ? null : "VERSION_NOT_AVAILABLE",
        correlationId,
      },
    });
    if (!version) throw new NotFoundException("Evidence version not found.");
    if (!allowed)
      throw new ConflictException(
        "Only an available evidence version can be downloaded.",
      );
    const grant = {
      url: `/api/v1/evidence/${asset.id}/versions/${version.id}/content`,
      expiresAt: new Date(
        Date.now() +
          this.environment.OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS * 1000,
      ).toISOString(),
    };
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: "EvidenceAsset",
        aggregateId: asset.id,
        aggregateVersion: asset.rowVersion,
        eventType: "evidence.access.granted",
        eventVersion: "1.0",
        payload: {
          evidenceAssetId: asset.id,
          evidenceVersionId: version.id,
          caseId: asset.primaryCaseId,
        },
        correlationId,
        organizationId: identity.organizationId,
        actorType: "USER",
        actorId: identity.userId,
      },
    });
    return grant;
  }

  async downloadContent(
    id: string,
    versionId: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const version = await this.prisma.evidenceVersion.findFirst({
      where: {
        id: versionId,
        evidenceAssetId: id,
        organizationId: identity.organizationId,
        processingStatus: "AVAILABLE",
      },
    });
    if (!version?.canonicalBucket || !version.canonicalKey)
      throw new NotFoundException("Available evidence content not found.");
    await this.prisma.evidenceAccessRecord.create({
      data: {
        organizationId: identity.organizationId,
        evidenceAssetId: id,
        evidenceVersionId: versionId,
        actorId: identity.userId,
        action: "DOWNLOAD_STREAM",
        outcome: "GRANTED",
        correlationId,
      },
    });
    return {
      stream: await this.storage.getObjectStream({
        bucket: version.canonicalBucket,
        key: version.canonicalKey,
      }),
      filename: version.displayFilename,
      mediaType: version.detectedMediaType ?? "application/octet-stream",
      sizeBytes: version.sizeBytes,
    };
  }

  async queueIntegrity(
    id: string,
    versionId: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const version = await this.prisma.evidenceVersion.findFirst({
      where: {
        id: versionId,
        evidenceAssetId: id,
        organizationId: identity.organizationId,
        processingStatus: "AVAILABLE",
      },
    });
    if (!version?.sha256)
      throw new ConflictException(
        "Only an available version can be integrity checked.",
      );
    return this.prisma.$transaction(async (tx) => {
      const check = await tx.evidenceIntegrityCheck.create({
        data: {
          organizationId: identity.organizationId,
          evidenceAssetId: id,
          evidenceVersionId: versionId,
          expectedSha256: version.sha256!,
          requestedBy: identity.userId,
          correlationId,
        },
      });
      await tx.evidenceProcessingJob.create({
        data: {
          organizationId: identity.organizationId,
          evidenceAssetId: id,
          evidenceVersionId: versionId,
          integrityCheckId: check.id,
          jobType: "INTEGRITY_CHECK",
          maxAttempts: this.environment.EVIDENCE_PROCESSING_MAX_ATTEMPTS,
          correlationId,
        },
      });
      return {
        id: check.id,
        status: check.status,
        requestedAt: check.requestedAt.toISOString(),
      };
    });
  }

  async integrityHistory(
    id: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const rows = await this.prisma.evidenceIntegrityCheck.findMany({
      where: {
        organizationId: identity.organizationId,
        evidenceAssetId: id,
      },
      orderBy: { requestedAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      versionId: row.evidenceVersionId,
      status: row.status,
      expectedSha256: row.expectedSha256,
      calculatedSha256: row.calculatedSha256,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    }));
  }

  async addRelationship(
    id: string,
    input: z.infer<typeof relationshipSchema>,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    if (id === input.relatedEvidenceId)
      throw new BadRequestException("Evidence cannot relate to itself.");
    const [asset, related] = await Promise.all([
      this.assetOr404(id, identity.organizationId),
      this.assetOr404(input.relatedEvidenceId, identity.organizationId),
    ]);
    await Promise.all([
      this.cases.assertAccessible(
        asset.primaryCaseId,
        identity.organizationId,
        correlationId,
      ),
      this.cases.assertAccessible(
        related.primaryCaseId,
        identity.organizationId,
        correlationId,
      ),
    ]);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const relationship = await tx.evidenceRelationship.create({
          data: {
            organizationId: identity.organizationId,
            fromEvidenceAssetId: id,
            toEvidenceAssetId: input.relatedEvidenceId,
            relationshipType: input.relationshipType,
            createdBy: identity.userId,
          },
        });
        await this.event(tx, {
          asset,
          identity,
          correlationId,
          eventType: "evidence.relationship.changed",
          payload: {
            relationshipId: relationship.id,
            relationshipType: relationship.relationshipType,
            relatedEvidenceAssetId: related.id,
            caseId: asset.primaryCaseId,
          },
        });
        return relationship;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new ConflictException("This relationship already exists.");
      throw error;
    }
  }

  async lineage(id: string, identity: EvidenceIdentity, correlationId: string) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const [versions, outgoing, incoming] = await Promise.all([
      this.prisma.evidenceVersion.findMany({
        where: {
          organizationId: identity.organizationId,
          evidenceAssetId: id,
        },
        orderBy: { versionNumber: "asc" },
      }),
      this.prisma.evidenceRelationship.findMany({
        where: {
          organizationId: identity.organizationId,
          fromEvidenceAssetId: id,
        },
      }),
      this.prisma.evidenceRelationship.findMany({
        where: {
          organizationId: identity.organizationId,
          toEvidenceAssetId: id,
        },
      }),
    ]);
    return {
      versions: versions.map((version) => this.serializeVersion(version)),
      relationships: [
        ...outgoing.map((row) => ({
          id: row.id,
          direction: "OUTGOING",
          type: row.relationshipType,
          relatedEvidenceId: row.toEvidenceAssetId,
          createdAt: row.createdAt.toISOString(),
        })),
        ...incoming.map((row) => ({
          id: row.id,
          direction: "INCOMING",
          type: row.relationshipType,
          relatedEvidenceId: row.fromEvidenceAssetId,
          createdAt: row.createdAt.toISOString(),
        })),
      ],
    };
  }

  async placeHold(
    id: string,
    reason: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    if (await this.activeHold(id, identity.organizationId))
      throw new ConflictException("Evidence is already on legal hold.");
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.evidenceLegalHold.create({
        data: {
          organizationId: identity.organizationId,
          evidenceAssetId: id,
          action: "PLACED",
          reason,
          actorId: identity.userId,
        },
      });
      const updated = await tx.evidenceAsset.update({
        where: { id },
        data: {
          status: "ON_HOLD",
          rowVersion: { increment: 1 },
          updatedBy: identity.userId,
        },
      });
      await this.event(tx, {
        asset: updated,
        identity,
        correlationId,
        eventType: "evidence.legal_hold.changed",
        payload: {
          holdId: hold.id,
          action: "PLACED",
          caseId: asset.primaryCaseId,
        },
      });
      return {
        id: hold.id,
        action: hold.action,
        reason: hold.reason,
        actedAt: hold.actedAt.toISOString(),
      };
    });
  }

  async releaseHold(
    id: string,
    holdId: string,
    reason: string,
    identity: EvidenceIdentity,
    correlationId: string,
  ) {
    const asset = await this.assetOr404(id, identity.organizationId);
    await this.cases.assertAccessible(
      asset.primaryCaseId,
      identity.organizationId,
      correlationId,
    );
    const active = await this.activeHold(id, identity.organizationId);
    if (!active || active.id !== holdId)
      throw new ConflictException("The legal hold is not active.");
    return this.prisma.$transaction(async (tx) => {
      const release = await tx.evidenceLegalHold.create({
        data: {
          organizationId: identity.organizationId,
          evidenceAssetId: id,
          action: "RELEASED",
          reason,
          actorId: identity.userId,
          relatedHoldId: holdId,
        },
      });
      const updated = await tx.evidenceAsset.update({
        where: { id },
        data: {
          status: asset.currentVersionId
            ? "ACTIVE"
            : asset.latestVersionNumber
              ? "PROCESSING"
              : "AWAITING_CONTENT",
          rowVersion: { increment: 1 },
          updatedBy: identity.userId,
        },
      });
      await this.event(tx, {
        asset: updated,
        identity,
        correlationId,
        eventType: "evidence.legal_hold.changed",
        payload: {
          holdId,
          releaseId: release.id,
          action: "RELEASED",
          caseId: asset.primaryCaseId,
        },
      });
      return {
        id: release.id,
        action: release.action,
        reason: release.reason,
        actedAt: release.actedAt.toISOString(),
      };
    });
  }

  async classifications(identity: EvidenceIdentity) {
    return this.prisma.evidenceClassification.findMany({
      where: {
        active: true,
        OR: [
          { organizationId: null },
          { organizationId: identity.organizationId },
        ],
      },
      select: { code: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
  }

  private assetOr404(id: string, organizationId: string) {
    return this.prisma.evidenceAsset
      .findFirst({ where: { id, organizationId } })
      .then((asset) => {
        if (!asset) throw new NotFoundException("Evidence not found.");
        return asset;
      });
  }

  private async assertClassification(code: string, organizationId: string) {
    const classification = await this.prisma.evidenceClassification.findFirst({
      where: {
        code,
        active: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
    });
    if (!classification)
      throw new BadRequestException("Evidence classification is not active.");
  }

  private async activeHold(assetId: string, organizationId: string) {
    const placed = await this.prisma.evidenceLegalHold.findFirst({
      where: {
        organizationId,
        evidenceAssetId: assetId,
        action: "PLACED",
      },
      orderBy: { actedAt: "desc" },
    });
    if (!placed) return null;
    const released = await this.prisma.evidenceLegalHold.findFirst({
      where: {
        organizationId,
        evidenceAssetId: assetId,
        action: "RELEASED",
        relatedHoldId: placed.id,
      },
    });
    return released ? null : placed;
  }

  serializeAsset(asset: EvidenceAsset, current?: EvidenceVersion | null) {
    return {
      id: asset.id,
      evidenceNumber: asset.evidenceNumber,
      primaryCaseId: asset.primaryCaseId,
      classificationCode: asset.classificationCode,
      title: asset.title,
      description: asset.description,
      sourceType: asset.sourceType,
      sourceSystemId: asset.sourceSystemId,
      connectorId: asset.connectorId,
      sourceTriggerId: asset.sourceTriggerId,
      externalReference: asset.externalReference,
      status: asset.status,
      currentVersionId: asset.currentVersionId,
      latestVersionNumber: asset.latestVersionNumber,
      versionCount: asset.latestVersionNumber,
      retentionPolicyCode: asset.retentionPolicyCode,
      rowVersion: asset.rowVersion,
      createdByType: asset.createdByType,
      createdById: asset.createdById,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      currentVersion: current ? this.serializeVersion(current) : null,
    };
  }

  serializeVersion(version: EvidenceVersion) {
    return {
      id: version.id,
      evidenceAssetId: version.evidenceAssetId,
      versionNumber: version.versionNumber,
      previousVersionId: version.previousVersionId,
      previousSha256: version.previousSha256,
      processingStatus: version.processingStatus,
      originalFilename: version.originalFilename,
      displayFilename: version.displayFilename,
      declaredMediaType: version.declaredMediaType,
      detectedMediaType: version.detectedMediaType,
      sizeBytes: version.sizeBytes?.toString() ?? null,
      sha256: version.sha256,
      scanEngine: version.scanEngine,
      scanCompletedAt: version.scanCompletedAt?.toISOString() ?? null,
      createdReason: version.createdReason,
      createdByType: version.createdByType,
      createdById: version.createdById,
      createdAt: version.createdAt.toISOString(),
      availableAt: version.availableAt?.toISOString() ?? null,
      failureCode: version.failureCode,
      failureDetail:
        version.processingStatus === "FAILED" ||
        version.processingStatus === "REJECTED"
          ? version.failureDetailSanitized
          : null,
    };
  }

  async event(
    tx: Prisma.TransactionClient,
    input: {
      asset: EvidenceAsset;
      version?: EvidenceVersion;
      identity: Pick<EvidenceIdentity, "userId">;
      correlationId: string;
      causationId?: string;
      eventType: string;
      payload: Record<string, unknown>;
      actorType?: "USER" | "SERVICE" | "SYSTEM";
    },
  ) {
    await tx.outboxEvent.create({
      data: {
        aggregateType: "EvidenceAsset",
        aggregateId: input.asset.id,
        aggregateVersion: input.asset.rowVersion,
        eventType: input.eventType,
        eventVersion: "1.0",
        payload: jsonSafe({
          evidenceAssetId: input.asset.id,
          ...(input.version
            ? {
                evidenceVersionId: input.version.id,
                versionNumber: input.version.versionNumber,
              }
            : {}),
          ...input.payload,
        }),
        correlationId: input.correlationId,
        ...(input.causationId ? { causationId: input.causationId } : {}),
        organizationId: input.asset.organizationId,
        actorType: input.actorType ?? "USER",
        actorId: input.identity.userId,
      },
    });
  }

  static hashesMatch(expected: string, calculated: string) {
    const left = Buffer.from(expected, "hex");
    const right = Buffer.from(calculated, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  }
}

export type { EvidenceObjectStorage, UploadPart };
