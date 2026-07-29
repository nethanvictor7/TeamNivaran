import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Prisma } from "@cdep/ai-prisma-client";
import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  CORTEX_GATEWAY,
  CortexGatewayError,
  type CortexGateway,
  type MockProfile,
} from "./cortex-gateway.js";
import { DependencyClients } from "./dependency-clients.js";
import { getEnvironment } from "./environment.js";
import { validateAssessmentOutput } from "./output-schema.js";
import { PrismaService } from "./prisma.service.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const terminal = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "POLICY_BLOCKED",
  "INVALID_OUTPUT",
  "SUPERSEDED",
];

@Injectable()
export class AssessmentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly environment = getEnvironment();
  private readonly owner = `ai-worker-${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly dependencies: DependencyClients,
    @Inject(CORTEX_GATEWAY) private readonly gateway: CortexGateway,
  ) {}

  onModuleInit() {
    if (!this.environment.AI_WORKER_ENABLED) return;
    this.timer = setInterval(
      () => void this.tick(),
      this.environment.AI_WORKER_POLL_INTERVAL_MS,
    );
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const candidate = await this.prisma.assessmentJobLease.findFirst({
        where: {
          expiresAt: { lt: new Date() },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
          assessment: {
            status: {
              in: [
                "QUEUED",
                "PREPARING_INPUT",
                "READY_FOR_INFERENCE",
                "SUBMITTED",
                "RUNNING",
                "VALIDATING_OUTPUT",
                "CANCEL_REQUESTED",
              ],
            },
          },
        },
        orderBy: { assessment: { requestedAt: "asc" } },
      });
      if (!candidate) return;
      const acquired = await this.prisma.assessmentJobLease.updateMany({
        where: {
          assessmentId: candidate.assessmentId,
          expiresAt: { lt: new Date() },
        },
        data: {
          owner: this.owner,
          expiresAt: new Date(
            Date.now() + this.environment.AI_WORKER_LEASE_SECONDS * 1000,
          ),
        },
      });
      if (acquired.count !== 1) return;
      await this.process(candidate.assessmentId);
    } finally {
      this.running = false;
    }
  }

  async process(assessmentId: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: {
        refs: true,
        prepared: true,
        executions: { orderBy: { attemptNumber: "desc" }, take: 1 },
      },
    });
    if (!assessment || terminal.includes(assessment.status)) return;
    if (assessment.status === "CANCEL_REQUESTED") {
      const execution = assessment.executions[0];
      if (execution?.providerExecutionId)
        await this.gateway.cancel(execution.providerExecutionId);
      await this.finish(assessment, "CANCELLED", "USER_CANCELLED");
      return;
    }
    const runtime = await this.prisma.aiRuntimeConfig.findUnique({
      where: { id: assessment.runtimeConfigId },
    });
    if (!runtime?.enabled) {
      await this.finish(assessment, "POLICY_BLOCKED", "RUNTIME_DISABLED");
      return;
    }
    const killSwitch = await this.prisma.aiKillSwitch.findFirst({
      where: {
        enabled: true,
        scope: { in: ["GLOBAL", "WORKER"] },
        OR: [
          { organizationId: assessment.organizationId },
          { organizationId: null },
        ],
      },
    });
    if (killSwitch) {
      await this.finish(assessment, "POLICY_BLOCKED", "KILL_SWITCH_ENABLED");
      return;
    }
    const attempt = (assessment.executions[0]?.attemptNumber ?? 0) + 1;
    try {
      const prepared =
        assessment.prepared ??
        (await this.prepare(assessment, runtime.maxInputBytes, assessment.id));
      await this.status(assessment.id, "READY_FOR_INFERENCE");
      const execution = await this.prisma.assessmentExecution.create({
        data: {
          assessmentId,
          attemptNumber: attempt,
          adapterMode: this.environment.AI_ADAPTER_MODE,
          mockProfile: runtime.mockProfile,
          status: "STARTED",
        },
      });
      const abort = AbortSignal.timeout(runtime.timeoutMs);
      const input = {
        assessmentId,
        inputFingerprint: prepared.fingerprint,
        profile: runtime.mockProfile as MockProfile,
        evidenceRefs: assessment.refs.map((ref) => ({
          evidenceAssetId: ref.evidenceAssetId,
          evidenceVersionId: ref.evidenceVersionId,
        })),
      };
      await this.status(assessment.id, "SUBMITTED");
      const startedAt = Date.now();
      const submission = await this.gateway.submit(input, abort);
      await this.prisma.assessmentExecution.update({
        where: { id: execution.id },
        data: {
          providerExecutionId: submission.providerExecutionId,
          submittedAt: new Date(submission.submittedAt),
          status: "SUBMITTED",
        },
      });
      await this.status(assessment.id, "RUNNING");
      const result = await this.gateway.result(submission, input, abort);
      await this.status(assessment.id, "VALIDATING_OUTPUT");
      let raw = result.rawOutput;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          throw new Error("OUTPUT_INVALID_JSON");
        }
      }
      const normalized = validateAssessmentOutput(raw, assessment.refs);
      const encrypted = this.encrypt(JSON.stringify(result.rawOutput));
      await this.prisma.$transaction(async (tx) => {
        await tx.assessmentExecution.update({
          where: { id: execution.id },
          data: {
            status: "SUCCEEDED",
            completedAt: new Date(result.completedAt),
            latencyMs: Date.now() - startedAt,
            rawOutputEncrypted: encrypted,
          },
        });
        await tx.assessmentOutput.create({
          data: {
            assessmentId,
            summary: normalized.summary,
            recommendation: normalized.recommendation,
            confidence: normalized.confidence,
            schemaVersion: normalized.schemaVersion,
            findings: { create: normalized.findings },
            missingInformation: { create: normalized.missingInformation },
            riskIndicators: { create: normalized.riskIndicators },
            citations: {
              create: normalized.citations.map((citation) => ({
                code: citation.code,
                evidenceAssetId: citation.evidenceAssetId,
                evidenceVersionId: citation.evidenceVersionId,
                excerpt: citation.excerpt ?? null,
              })),
            },
          },
        });
        await tx.assessmentUsage.upsert({
          where: { assessmentId },
          create: {
            assessmentId,
            inputBytes: prepared.byteCount,
            evidenceItemCount: assessment.refs.length,
            outputBytes: Buffer.byteLength(JSON.stringify(result.rawOutput)),
            adapterMode: this.environment.AI_ADAPTER_MODE,
          },
          update: {
            outputBytes: Buffer.byteLength(JSON.stringify(result.rawOutput)),
          },
        });
        await tx.assessment.update({
          where: { id: assessmentId },
          data: {
            status: "SUCCEEDED",
            completedAt: new Date(),
            statusReasonCode: null,
            rowVersion: { increment: 1 },
          },
        });
        await tx.assessmentJobLease.delete({ where: { assessmentId } });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "Assessment",
            aggregateId: assessmentId,
            aggregateVersion: assessment.rowVersion + 1,
            eventType: "ai.assessment.succeeded",
            eventVersion: "1.0",
            payload: json({
              assessmentId,
              caseId: assessment.caseId,
              adapterMode: "MOCK",
            }),
            correlationId: assessmentId,
            organizationId: assessment.organizationId,
            actorType: "SYSTEM",
            actorId: assessment.requestedBy,
          },
        });
      });
    } catch (error) {
      await this.fail(assessment, attempt, runtime.retryLimit, error);
    }
  }

  private async prepare(
    assessment: {
      id: string;
      organizationId: string;
      caseId: string;
      workflowVersion: number;
      refs: Array<{
        evidenceAssetId: string;
        evidenceVersionId: string;
        sha256: string;
        mediaType: string | null;
      }>;
    },
    maximumBytes: number,
    correlationId: string,
  ) {
    await this.status(assessment.id, "PREPARING_INPUT", true);
    const [caseSnapshot, workflow] = await Promise.all([
      this.dependencies.caseSnapshot(
        assessment.organizationId,
        assessment.caseId,
        correlationId,
      ),
      this.dependencies.workflowContext(
        assessment.organizationId,
        assessment.caseId,
        correlationId,
      ),
    ]);
    if (workflow.rowVersion !== assessment.workflowVersion)
      throw new Error("INPUT_SUPERSEDED");
    const records: Array<Record<string, unknown>> = [];
    const excluded: Array<Record<string, unknown>> = [];
    let bytes = 0;
    for (const ref of assessment.refs) {
      if (ref.mediaType !== "text/plain") {
        excluded.push({
          evidenceAssetId: ref.evidenceAssetId,
          evidenceVersionId: ref.evidenceVersionId,
          reason: "PARSER_NOT_IMPLEMENTED",
          mediaType: ref.mediaType,
        });
        continue;
      }
      const remaining = maximumBytes - bytes;
      if (remaining <= 0) throw new Error("INPUT_LIMIT_EXCEEDED");
      const content = await this.dependencies.evidenceContent(
        {
          organizationId: assessment.organizationId,
          caseId: assessment.caseId,
          evidenceAssetId: ref.evidenceAssetId,
          evidenceVersionId: ref.evidenceVersionId,
          expectedSha256: ref.sha256,
          maximumBytes: remaining,
        },
        correlationId,
      );
      bytes += content.content.length;
      records.push({
        evidenceAssetId: ref.evidenceAssetId,
        evidenceVersionId: ref.evidenceVersionId,
        sha256: ref.sha256,
        mediaType: content.mediaType,
        text: content.content.toString("utf8"),
      });
    }
    if (!records.length) throw new Error("NO_SUPPORTED_EVIDENCE_CONTENT");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          caseSnapshot,
          workflow: {
            id: workflow.id,
            rowVersion: workflow.rowVersion,
            validationRunId: workflow.validation.id,
          },
          records,
          excluded,
        }),
      )
      .digest("hex");
    await this.prisma.assessment.update({
      where: { id: assessment.id },
      data: { inputFingerprint: fingerprint },
    });
    return this.prisma.preparedInput.create({
      data: {
        assessmentId: assessment.id,
        caseSnapshot: json(caseSnapshot),
        workflowSnapshot: json(workflow),
        contentRecords: json(records),
        excludedRecords: json(excluded),
        byteCount: bytes,
        fingerprint,
      },
    });
  }

  private async fail(
    assessment: {
      id: string;
      status: string;
      rowVersion: number;
      organizationId: string;
      caseId: string;
      requestedBy: string;
    },
    attempt: number,
    retryLimit: number,
    error: unknown,
  ) {
    const code =
      error instanceof CortexGatewayError
        ? error.code
        : error instanceof Error
          ? error.message.slice(0, 100)
          : "ASSESSMENT_FAILED";
    const retryable =
      error instanceof CortexGatewayError
        ? error.retryable
        : ["DEPENDENCY_UNAVAILABLE"].includes(code);
    const invalid =
      code.startsWith("OUTPUT_") ||
      code === "OUTPUT_BAD_CITATION" ||
      code === "OUTPUT_DUPLICATE_CODE" ||
      code.startsWith("[");
    const policyBlocked = code === "MOCK_POLICY_BLOCK";
    const superseded = code === "INPUT_SUPERSEDED";
    const shouldRetry = retryable && attempt <= retryLimit;
    await this.prisma.$transaction(async (tx) => {
      await tx.assessmentFailure.create({
        data: {
          assessmentId: assessment.id,
          attemptNumber: attempt,
          code,
          retryable,
          detailSanitized: code,
        },
      });
      await tx.assessmentExecution.updateMany({
        where: { assessmentId: assessment.id, attemptNumber: attempt },
        data: { status: "FAILED", errorCode: code, completedAt: new Date() },
      });
      if (shouldRetry) {
        await tx.assessment.update({
          where: { id: assessment.id },
          data: {
            status: "READY_FOR_INFERENCE",
            statusReasonCode: code,
            rowVersion: { increment: 1 },
          },
        });
        await tx.assessmentJobLease.update({
          where: { assessmentId: assessment.id },
          data: {
            owner: "unleased",
            expiresAt: new Date(0),
            attempt: { increment: 1 },
            nextAttemptAt: new Date(
              Date.now() + Math.min(30_000, 500 * 2 ** attempt),
            ),
          },
        });
        return;
      }
      const status = superseded
        ? "SUPERSEDED"
        : policyBlocked
          ? "POLICY_BLOCKED"
          : invalid
            ? "INVALID_OUTPUT"
            : "FAILED";
      await tx.assessment.update({
        where: { id: assessment.id },
        data: {
          status,
          statusReasonCode: code,
          completedAt: new Date(),
          supersededAt: superseded ? new Date() : null,
          rowVersion: { increment: 1 },
        },
      });
      await tx.assessmentJobLease.delete({
        where: { assessmentId: assessment.id },
      });
    });
  }

  private async status(
    assessmentId: string,
    status:
      | "PREPARING_INPUT"
      | "READY_FOR_INFERENCE"
      | "SUBMITTED"
      | "RUNNING"
      | "VALIDATING_OUTPUT",
    started = false,
  ) {
    await this.prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        status,
        ...(started ? { startedAt: new Date() } : {}),
        rowVersion: { increment: 1 },
      },
    });
  }
  private async finish(
    assessment: {
      id: string;
      rowVersion: number;
      organizationId: string;
      caseId: string;
      requestedBy: string;
    },
    status: "CANCELLED" | "POLICY_BLOCKED",
    reason: string,
  ) {
    await this.prisma.$transaction([
      this.prisma.assessment.update({
        where: { id: assessment.id },
        data: {
          status,
          statusReasonCode: reason,
          completedAt: new Date(),
          cancelledAt: status === "CANCELLED" ? new Date() : null,
          rowVersion: { increment: 1 },
        },
      }),
      this.prisma.assessmentJobLease.delete({
        where: { assessmentId: assessment.id },
      }),
    ]);
  }
  private encrypt(plaintext: string) {
    const key = createHash("sha256")
      .update(this.environment.AI_OUTPUT_ENCRYPTION_KEY)
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  }
}
