import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type {
  EvidenceAsset,
  EvidenceProcessingJob,
  EvidenceVersion,
  Prisma,
} from "@cdep/evidence-prisma-client";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { EvidenceService } from "./evidence.service.js";
import { getEnvironment } from "./environment.js";
import { ClamAvScanner } from "./malware-scanner.js";
import { S3EvidenceObjectStorage } from "./object-storage.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class EvidenceProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvidenceProcessingWorker.name);
  private readonly environment = getEnvironment();
  private readonly ownerId = randomUUID();
  private timer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  private working = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3EvidenceObjectStorage,
    private readonly scanner: ClamAvScanner,
    private readonly evidence: EvidenceService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick(),
      this.environment.EVIDENCE_WORKER_POLL_MS,
    );
    this.timer.unref();
    this.reconcileTimer = setInterval(() => void this.reconcile(), 30_000);
    this.reconcileTimer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    await this.prisma.evidenceProcessingJob.updateMany({
      where: { leaseOwner: this.ownerId, status: "LEASED" },
      data: { status: "RETRY", leaseOwner: null, leaseExpiresAt: null },
    });
  }

  private async tick() {
    if (this.working || this.stopping) return;
    this.working = true;
    try {
      const job = await this.claim();
      if (!job) return;
      if (job.jobType === "MALWARE_SCAN") await this.scan(job);
      else if (job.jobType === "INTEGRITY_CHECK") await this.integrity(job);
      else await this.complete(job.id);
    } catch (error) {
      this.logger.error({
        event: "evidence.processing.error",
        code: "PROCESSING_TICK_FAILED",
        detail: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      this.working = false;
    }
  }

  private async claim() {
    const now = new Date();
    const candidate = await this.prisma.evidenceProcessingJob.findFirst({
      where: {
        availableAt: { lte: now },
        OR: [
          { status: { in: ["PENDING", "RETRY"] } },
          { status: "LEASED", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;
    const claimed = await this.prisma.evidenceProcessingJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: { in: ["PENDING", "RETRY"] } },
          { status: "LEASED", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "LEASED",
        leaseOwner: this.ownerId,
        leaseExpiresAt: new Date(
          Date.now() +
            this.environment.EVIDENCE_PROCESSING_LEASE_SECONDS * 1000,
        ),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.evidenceProcessingJob.findUniqueOrThrow({
      where: { id: candidate.id },
    });
  }

  private async scan(job: EvidenceProcessingJob) {
    if (!job.evidenceVersionId) return this.fail(job, "VERSION_MISSING");
    const version = await this.prisma.evidenceVersion.findFirst({
      where: {
        id: job.evidenceVersionId,
        organizationId: job.organizationId,
      },
    });
    const asset = await this.prisma.evidenceAsset.findFirst({
      where: {
        id: job.evidenceAssetId,
        organizationId: job.organizationId,
      },
    });
    if (
      !version ||
      !asset ||
      !version.quarantineBucket ||
      !version.quarantineKey
    )
      return this.fail(job, "QUARANTINE_REFERENCE_MISSING");
    if (version.processingStatus === "AVAILABLE") return this.complete(job.id);
    await this.prisma.evidenceVersion.updateMany({
      where: {
        id: version.id,
        processingStatus: { in: ["UPLOADED", "SCANNING"] },
      },
      data: { processingStatus: "SCANNING" },
    });
    const startedAt = new Date();
    try {
      const stream = await this.storage.getObjectStream({
        bucket: version.quarantineBucket,
        key: version.quarantineKey,
      });
      const result = await this.scanner.scan({
        stream,
        timeoutMs: this.environment.CLAMAV_SCAN_TIMEOUT_MS,
      });
      const completedAt = new Date();
      await this.prisma.malwareScanAttempt.create({
        data: {
          organizationId: job.organizationId,
          evidenceVersionId: version.id,
          attemptNumber: job.attempts,
          status: result.status,
          engine: result.engine,
          ...(result.signatureVersion
            ? { signatureVersion: result.signatureVersion }
            : {}),
          findingCodes: result.findingCodes,
          startedAt,
          completedAt,
          failureDetailSanitized:
            result.status === "ERROR"
              ? "The malware scanner did not return a clean result."
              : null,
        },
      });
      if (result.status === "INFECTED") {
        await this.rejectInfected(job, asset, version, result.engine);
        return;
      }
      if (result.status !== "CLEAN") {
        await this.fail(job, "SCAN_ERROR", asset, version);
        return;
      }
      await this.promote(job, asset, version, result.engine);
    } catch (error) {
      await this.prisma.malwareScanAttempt
        .create({
          data: {
            organizationId: job.organizationId,
            evidenceVersionId: version.id,
            attemptNumber: job.attempts,
            status: "ERROR",
            engine: "ClamAV",
            findingCodes: ["SCAN_ERROR"],
            startedAt,
            completedAt: new Date(),
            failureDetailSanitized: "The malware scan could not complete.",
          },
        })
        .catch(() => undefined);
      await this.fail(job, "SCAN_UNAVAILABLE", asset, version);
    }
  }

  private async rejectInfected(
    job: EvidenceProcessingJob,
    asset: EvidenceAsset,
    version: EvidenceVersion,
    engine: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const rejected = await tx.evidenceVersion.update({
        where: { id: version.id },
        data: {
          processingStatus: "REJECTED",
          scanEngine: engine,
          scanCompletedAt: new Date(),
          failureCode: "MALWARE_DETECTED",
          failureDetailSanitized: "The file was rejected by the security scan.",
        },
      });
      const updatedAsset = await tx.evidenceAsset.update({
        where: { id: asset.id },
        data: {
          status: asset.currentVersionId ? asset.status : "REJECTED",
          rowVersion: { increment: 1 },
          updatedBy: "evidence-processing-worker",
        },
      });
      await tx.evidenceProcessingJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await this.evidence.event(tx, {
        asset: updatedAsset,
        version: rejected,
        identity: { userId: "evidence-processing-worker" },
        actorType: "SYSTEM",
        correlationId: job.correlationId,
        ...(job.causationId ? { causationId: job.causationId } : {}),
        eventType: "evidence.version.rejected",
        payload: {
          evidenceNumber: asset.evidenceNumber,
          caseId: asset.primaryCaseId,
          classificationCode: asset.classificationCode,
          evidenceStatus: updatedAsset.status,
          sourceType: asset.sourceType,
          failureCode: "MALWARE_DETECTED",
        },
      });
    });
  }

  private async promote(
    job: EvidenceProcessingJob,
    asset: EvidenceAsset,
    version: EvidenceVersion,
    engine: string,
  ) {
    if (!version.canonicalKey || !version.sha256 || version.sizeBytes == null) {
      await this.fail(job, "VERSION_METADATA_INCOMPLETE", asset, version);
      return;
    }
    let canonical:
      { bucket: string; key: string; providerVersionId?: string } | undefined;
    try {
      canonical = await this.storage.promoteToCanonical({
        quarantineBucket: version.quarantineBucket!,
        quarantineKey: version.quarantineKey!,
        canonicalKey: version.canonicalKey,
      });
      const head = await this.storage.headObject({
        bucket: canonical.bucket,
        key: canonical.key,
      });
      if (BigInt(head.sizeBytes) !== version.sizeBytes)
        throw new Error("CANONICAL_SIZE_MISMATCH");
      const calculated = await this.hashObject(canonical.bucket, canonical.key);
      if (!EvidenceService.hashesMatch(version.sha256, calculated))
        throw new Error("CANONICAL_HASH_MISMATCH");
      await this.prisma.$transaction(async (tx) => {
        const available = await tx.evidenceVersion.update({
          where: { id: version.id },
          data: {
            processingStatus: "AVAILABLE",
            canonicalBucket: canonical!.bucket,
            canonicalKey: canonical!.key,
            objectVersionId:
              canonical!.providerVersionId ?? version.objectVersionId,
            scanEngine: engine,
            scanCompletedAt: new Date(),
            availableAt: new Date(),
            failureCode: null,
            failureDetailSanitized: null,
          },
        });
        const updatedAsset = await tx.evidenceAsset.update({
          where: { id: asset.id },
          data: {
            currentVersionId: available.id,
            status: asset.status === "ON_HOLD" ? "ON_HOLD" : "ACTIVE",
            rowVersion: { increment: 1 },
            updatedBy: "evidence-processing-worker",
          },
        });
        await tx.evidenceProcessingJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await this.evidence.event(tx, {
          asset: updatedAsset,
          version: available,
          identity: { userId: "evidence-processing-worker" },
          actorType: "SYSTEM",
          correlationId: job.correlationId,
          ...(job.causationId ? { causationId: job.causationId } : {}),
          eventType: "evidence.version.scan.completed",
          payload: {
            caseId: asset.primaryCaseId,
            scanStatus: "CLEAN",
          },
        });
        await this.evidence.event(tx, {
          asset: updatedAsset,
          version: available,
          identity: { userId: "evidence-processing-worker" },
          actorType: "SYSTEM",
          correlationId: job.correlationId,
          ...(job.causationId ? { causationId: job.causationId } : {}),
          eventType: "evidence.version.available",
          payload: {
            evidenceNumber: asset.evidenceNumber,
            caseId: asset.primaryCaseId,
            classificationCode: asset.classificationCode,
            evidenceStatus: updatedAsset.status,
            sourceType: asset.sourceType,
          },
        });
      });
      await this.storage
        .deleteQuarantineObject({
          bucket: version.quarantineBucket!,
          key: version.quarantineKey!,
        })
        .catch((error) =>
          this.logger.warn({
            event: "evidence.quarantine.cleanup.deferred",
            code: error instanceof Error ? error.message : "unknown",
          }),
        );
    } catch (error) {
      if (canonical) {
        await this.prisma.orphanObjectCandidate.upsert({
          where: {
            bucket_objectKey_kind: {
              bucket: canonical.bucket,
              objectKey: canonical.key,
              kind: "CANONICAL",
            },
          },
          update: { lastCheckedAt: new Date() },
          create: {
            organizationId: asset.organizationId,
            evidenceVersionId: version.id,
            bucket: canonical.bucket,
            objectKey: canonical.key,
            kind: "CANONICAL",
            eligibleAfter: new Date(
              Date.now() +
                this.environment.EVIDENCE_ORPHAN_SAFETY_PERIOD_HOURS *
                  60 *
                  60 *
                  1000,
            ),
            detailSanitized:
              "Canonical copy exists but database finalization did not complete.",
          },
        });
      }
      await this.fail(
        job,
        error instanceof Error
          ? error.message.slice(0, 80)
          : "PROMOTION_FAILED",
        asset,
        version,
      );
    }
  }

  private async integrity(job: EvidenceProcessingJob) {
    if (!job.integrityCheckId || !job.evidenceVersionId) {
      await this.fail(job, "INTEGRITY_REFERENCE_MISSING");
      return;
    }
    const [check, version, asset] = await Promise.all([
      this.prisma.evidenceIntegrityCheck.findUnique({
        where: { id: job.integrityCheckId },
      }),
      this.prisma.evidenceVersion.findUnique({
        where: { id: job.evidenceVersionId },
      }),
      this.prisma.evidenceAsset.findUnique({
        where: { id: job.evidenceAssetId },
      }),
    ]);
    if (
      !check ||
      !version ||
      !asset ||
      version.processingStatus !== "AVAILABLE" ||
      !version.canonicalBucket ||
      !version.canonicalKey ||
      !version.sha256
    ) {
      await this.fail(job, "INTEGRITY_VERSION_UNAVAILABLE");
      return;
    }
    try {
      const calculated = await this.hashObject(
        version.canonicalBucket,
        version.canonicalKey,
      );
      const match = EvidenceService.hashesMatch(
        check.expectedSha256,
        calculated,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.evidenceIntegrityCheck.update({
          where: { id: check.id },
          data: {
            status: match ? "MATCH" : "MISMATCH",
            calculatedSha256: calculated,
            completedAt: new Date(),
          },
        });
        await tx.evidenceProcessingJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await this.evidence.event(tx, {
          asset,
          version,
          identity: { userId: "evidence-integrity-worker" },
          actorType: "SYSTEM",
          correlationId: job.correlationId,
          ...(job.causationId ? { causationId: job.causationId } : {}),
          eventType: match
            ? "evidence.integrity.verified"
            : "evidence.integrity.failed",
          payload: {
            caseId: asset.primaryCaseId,
            integrityCheckId: check.id,
            result: match ? "MATCH" : "MISMATCH",
          },
        });
      });
    } catch {
      await this.fail(job, "INTEGRITY_CHECK_FAILED", asset, version);
      await this.prisma.evidenceIntegrityCheck.update({
        where: { id: check.id },
        data: {
          status: "ERROR",
          completedAt: new Date(),
          failureDetailSanitized:
            "The stored object could not be integrity checked.",
        },
      });
    }
  }

  private async hashObject(bucket: string, key: string) {
    const stream = await this.storage.getObjectStream({ bucket, key });
    const hash = createHash("sha256");
    for await (const chunk of stream as Readable)
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return hash.digest("hex");
  }

  private async complete(id: string) {
    await this.prisma.evidenceProcessingJob.updateMany({
      where: { id, leaseOwner: this.ownerId, status: "LEASED" },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  private async fail(
    job: EvidenceProcessingJob,
    code: string,
    asset?: EvidenceAsset,
    version?: EvidenceVersion,
  ) {
    const exhausted = job.attempts >= job.maxAttempts;
    await this.prisma.$transaction(async (tx) => {
      await tx.evidenceProcessingJob.update({
        where: { id: job.id },
        data: exhausted
          ? {
              status: "FAILED",
              lastErrorCode: code,
              completedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
            }
          : {
              status: "RETRY",
              lastErrorCode: code,
              availableAt: new Date(
                Date.now() + Math.min(60_000, 1000 * 2 ** job.attempts),
              ),
              leaseOwner: null,
              leaseExpiresAt: null,
            },
      });
      if (exhausted && version) {
        const failedVersion = await tx.evidenceVersion.update({
          where: { id: version.id },
          data: {
            processingStatus: "FAILED",
            failureCode: code,
            failureDetailSanitized:
              "Evidence processing did not complete. An authorized user may retry with a new version.",
          },
        });
        if (asset) {
          const updatedAsset = await tx.evidenceAsset.update({
            where: { id: asset.id },
            data: {
              status: asset.currentVersionId ? asset.status : "REJECTED",
              rowVersion: { increment: 1 },
              updatedBy: "evidence-processing-worker",
            },
          });
          await this.evidence.event(tx, {
            asset: updatedAsset,
            version: failedVersion,
            identity: { userId: "evidence-processing-worker" },
            actorType: "SYSTEM",
            correlationId: job.correlationId,
            eventType: "evidence.version.failed",
            payload: {
              evidenceNumber: asset.evidenceNumber,
              caseId: asset.primaryCaseId,
              classificationCode: asset.classificationCode,
              evidenceStatus: updatedAsset.status,
              sourceType: asset.sourceType,
              failureCode: code,
            },
          });
        }
      }
    });
  }

  async reconcile() {
    if (this.stopping) return;
    const now = new Date();
    await this.prisma.evidenceProcessingJob.updateMany({
      where: { status: "LEASED", leaseExpiresAt: { lt: now } },
      data: { status: "RETRY", leaseOwner: null, leaseExpiresAt: null },
    });
    const abandoned = await this.prisma.evidenceUploadSession.findMany({
      where: { status: "OPEN", expiresAt: { lt: now } },
      take: 50,
    });
    for (const session of abandoned) {
      await this.prisma.$transaction(async (tx) => {
        const version = await tx.evidenceVersion.findUnique({
          where: { id: session.evidenceVersionId },
        });
        await tx.evidenceUploadSession.update({
          where: { id: session.id },
          data: { status: "ABANDONED", failureCode: "UPLOAD_ABANDONED" },
        });
        await tx.evidenceVersion.updateMany({
          where: {
            id: session.evidenceVersionId,
            processingStatus: "UPLOAD_PENDING",
          },
          data: {
            processingStatus: "FAILED",
            failureCode: "UPLOAD_ABANDONED",
            failureDetailSanitized: "The upload session expired.",
          },
        });
        if (version?.quarantineKey) {
          await tx.orphanObjectCandidate.upsert({
            where: {
              bucket_objectKey_kind: {
                bucket:
                  version.quarantineBucket ??
                  this.environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
                objectKey: version.quarantineKey,
                kind: "ABANDONED_UPLOAD",
              },
            },
            update: {},
            create: {
              organizationId: session.organizationId,
              evidenceVersionId: version.id,
              bucket:
                version.quarantineBucket ??
                this.environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
              objectKey: version.quarantineKey,
              kind: "ABANDONED_UPLOAD",
              eligibleAfter: new Date(
                Date.now() +
                  this.environment.EVIDENCE_ORPHAN_SAFETY_PERIOD_HOURS *
                    60 *
                    60 *
                    1000,
              ),
            },
          });
        }
      });
    }
    const candidates = await this.prisma.orphanObjectCandidate.findMany({
      where: { status: "CANDIDATE", eligibleAfter: { lte: now } },
      take: 25,
    });
    for (const candidate of candidates) {
      if (candidate.kind === "CANONICAL") {
        await this.prisma.orphanObjectCandidate.update({
          where: { id: candidate.id },
          data: {
            status: "RETAINED",
            lastCheckedAt: now,
            detailSanitized:
              "Canonical candidates are retained; Phase 3 never physically deletes canonical evidence.",
          },
        });
        continue;
      }
      const version = candidate.evidenceVersionId
        ? await this.prisma.evidenceVersion.findUnique({
            where: { id: candidate.evidenceVersionId },
          })
        : null;
      const asset = version
        ? await this.prisma.evidenceAsset.findUnique({
            where: { id: version.evidenceAssetId },
          })
        : null;
      const placed = asset
        ? await this.prisma.evidenceLegalHold.findFirst({
            where: {
              evidenceAssetId: asset.id,
              organizationId: asset.organizationId,
              action: "PLACED",
            },
            orderBy: { actedAt: "desc" },
          })
        : null;
      const released = placed
        ? await this.prisma.evidenceLegalHold.findFirst({
            where: { relatedHoldId: placed.id, action: "RELEASED" },
          })
        : null;
      if (placed && !released) {
        await this.prisma.orphanObjectCandidate.update({
          where: { id: candidate.id },
          data: { status: "RETAINED", lastCheckedAt: now },
        });
        continue;
      }
      if (
        version?.canonicalKey === candidate.objectKey ||
        version?.processingStatus === "AVAILABLE"
      ) {
        await this.prisma.orphanObjectCandidate.update({
          where: { id: candidate.id },
          data: { status: "RESOLVED", lastCheckedAt: now },
        });
        continue;
      }
      await this.storage
        .deleteQuarantineObject({
          bucket: candidate.bucket,
          key: candidate.objectKey,
        })
        .catch(() => undefined);
      await this.prisma.orphanObjectCandidate.update({
        where: { id: candidate.id },
        data: { status: "CLEANED", lastCheckedAt: now },
      });
    }
  }
}
