import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@cdep/ai-prisma-client";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AiIdentity } from "./authentication.js";
import { CORTEX_GATEWAY, type CortexGateway } from "./cortex-gateway.js";
import { DependencyClients } from "./dependency-clients.js";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma.service.js";

export const createAssessmentSchema = z
  .object({
    modelPolicyId: z.uuid(),
    purpose: z.string().trim().min(3).max(240),
    expectedWorkflowVersion: z.number().int().positive().optional(),
  })
  .strict();
export const feedbackSchema = z
  .object({
    rating: z.enum(["HELPFUL", "PARTIALLY_HELPFUL", "NOT_HELPFUL"]),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export const acceptanceSchema = z
  .object({
    expectedWorkflowVersion: z.number().int().positive(),
    selectedItems: z
      .array(
        z
          .object({
            itemType: z.enum([
              "FINDING",
              "MISSING_INFORMATION",
              "RISK_INDICATOR",
            ]),
            itemCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const runtimeConfigSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
    mockProfile: z.enum([
      "SUCCESS",
      "MISSING_INFORMATION",
      "RISK_INDICATORS",
      "INVALID_JSON",
      "INVALID_SCHEMA",
      "BAD_CITATION",
      "POLICY_BLOCK",
      "TIMEOUT",
      "TRANSIENT_FAILURE",
      "DELAYED_RESULT",
    ]),
    enabled: z.boolean().default(true),
    maxInputBytes: z
      .number()
      .int()
      .min(1024)
      .max(10_485_760)
      .default(1_048_576),
    maxEvidenceItems: z.number().int().min(1).max(100).default(25),
    timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
    retryLimit: z.number().int().min(0).max(10).default(3),
  })
  .strict();
export const modelPolicySchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
    runtimeConfigId: z.uuid(),
    promptTemplateVersionId: z.uuid(),
    allowedClassifications: z.array(z.string().min(1).max(100)).min(1).max(50),
    allowedMediaTypes: z.array(z.string().min(1).max(160)).min(1).max(20),
    purpose: z.string().trim().min(3).max(240),
    enabled: z.boolean().default(true),
  })
  .strict();
export const promptTemplateSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export const promptVersionSchema = z
  .object({
    systemPrompt: z.string().trim().min(20).max(10_000),
  })
  .strict();
export const killSwitchSchema = z
  .object({
    scope: z.enum(["GLOBAL", "ASSESSMENT_REQUEST", "WORKER"]),
    enabled: z.boolean(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export const runtimeConfigPatchSchema = runtimeConfigSchema
  .omit({ code: true })
  .partial()
  .extend({ expectedUpdatedAt: z.iso.datetime().optional() })
  .strict();
export const modelPolicyPatchSchema = modelPolicySchema
  .omit({ code: true })
  .partial()
  .extend({ expectedUpdatedAt: z.iso.datetime().optional() })
  .strict();
export const promptVersionPatchSchema = promptVersionSchema.partial().strict();

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class AssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dependencies: DependencyClients,
    @Inject(CORTEX_GATEWAY) private readonly cortex: CortexGateway,
  ) {}

  async request(
    caseId: string,
    input: z.infer<typeof createAssessmentSchema>,
    identity: AiIdentity,
    correlationId: string,
    idempotencyKey: string,
  ) {
    if (!getEnvironment().AI_ASSESSMENTS_ENABLED)
      throw new ServiceUnavailableException("AI assessments are disabled.");
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new BadRequestException("A valid Idempotency-Key is required.");
    const route = `/api/v1/cases/${caseId}/ai-assessments`;
    const requestHash = sha(input);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_actorId_route_key: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key: idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ConflictException(
          "The Idempotency-Key was already used with a different request.",
        );
      return existing.responseBody;
    }
    const [caseSnapshot, workflow, evidence, policy, killSwitch] =
      await Promise.all([
        this.dependencies.caseSnapshot(
          identity.organizationId,
          caseId,
          correlationId,
        ),
        this.dependencies.workflowContext(
          identity.organizationId,
          caseId,
          correlationId,
        ),
        this.dependencies.evidenceSnapshot(
          identity.organizationId,
          caseId,
          correlationId,
        ),
        this.prisma.modelPolicy.findFirst({
          where: {
            id: input.modelPolicyId,
            enabled: true,
            OR: [
              { organizationId: identity.organizationId },
              { organizationId: null },
            ],
          },
        }),
        this.prisma.aiKillSwitch.findFirst({
          where: {
            enabled: true,
            scope: { in: ["GLOBAL", "ASSESSMENT_REQUEST"] },
            OR: [
              { organizationId: identity.organizationId },
              { organizationId: null },
            ],
          },
        }),
      ]);
    if (killSwitch)
      throw new ServiceUnavailableException(
        "AI assessment requests are disabled by governance.",
      );
    if (!policy) throw new NotFoundException("Enabled model policy not found.");
    const [runtime, prompt] = await Promise.all([
      this.prisma.aiRuntimeConfig.findUnique({
        where: { id: policy.runtimeConfigId },
      }),
      this.prisma.promptTemplateVersion.findUnique({
        where: { id: policy.promptTemplateVersionId },
      }),
    ]);
    if (!runtime?.enabled || prompt?.status !== "PUBLISHED")
      throw new ConflictException(
        "The selected policy does not reference active governance records.",
      );
    if (
      ![
        "READY_FOR_REVIEW",
        "UNDER_REVIEW",
        "READY_FOR_RECOMMENDATION",
      ].includes(workflow.state) ||
      workflow.validation.status === "ERROR"
    )
      throw new ConflictException(
        "The Workflow is not eligible for an AI assessment.",
      );
    if (
      input.expectedWorkflowVersion &&
      input.expectedWorkflowVersion !== workflow.rowVersion
    )
      throw new ConflictException("The Workflow version has changed.");
    const authoritative = evidence.items.filter(
      (item) =>
        item.authoritative &&
        item.processingStatus === "AVAILABLE" &&
        item.malwareStatus === "CLEAN",
    );
    const allowedClassifications = new Set(
      policy.allowedClassifications as string[],
    );
    const allowedMediaTypes = new Set(policy.allowedMediaTypes as string[]);
    const refs = authoritative
      .filter(
        (item) =>
          allowedClassifications.has(item.classificationCode) &&
          (!item.mimeType || allowedMediaTypes.has(item.mimeType)),
      )
      .slice(0, runtime.maxEvidenceItems);
    if (!refs.length)
      throw new ConflictException(
        "No clean authoritative Evidence version is eligible under this policy.",
      );
    const created = await this.prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.create({
        data: {
          organizationId: identity.organizationId,
          caseId,
          workflowInstanceId: workflow.id,
          workflowVersion: workflow.rowVersion,
          validationRunId: workflow.validation.id,
          caseVersion: caseSnapshot.version,
          modelPolicyId: policy.id,
          runtimeConfigId: runtime.id,
          promptTemplateVersionId: prompt.id,
          purpose: input.purpose,
          requestedBy: identity.userId,
          refs: {
            create: refs.map((ref) => ({
              evidenceAssetId: ref.evidenceAssetId,
              evidenceVersionId: ref.evidenceVersionId,
              sha256: ref.sha256,
              classificationCode: ref.classificationCode,
              mediaType: ref.mimeType,
              sizeBytes: ref.sizeBytes ? BigInt(ref.sizeBytes) : null,
              availableAt: new Date(ref.availableAt),
            })),
          },
        },
        include: { refs: true },
      });
      await tx.assessmentJobLease.create({
        data: {
          assessmentId: assessment.id,
          owner: "unleased",
          expiresAt: new Date(0),
        },
      });
      const response = {
        id: assessment.id,
        caseId: assessment.caseId,
        status: assessment.status,
        requestedAt: assessment.requestedAt,
      };
      await tx.idempotencyRecord.create({
        data: {
          organizationId: identity.organizationId,
          actorId: identity.userId,
          route,
          key: idempotencyKey,
          requestHash,
          responseStatus: 202,
          responseBody: json(response),
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Assessment",
          aggregateId: assessment.id,
          aggregateVersion: assessment.rowVersion,
          eventType: "ai.assessment.requested",
          eventVersion: "1.0",
          payload: json({
            assessmentId: assessment.id,
            caseId,
            status: assessment.status,
          }),
          correlationId,
          organizationId: identity.organizationId,
          actorType: "USER",
          actorId: identity.userId,
        },
      });
      return response;
    });
    return created;
  }

  list(caseId: string, identity: AiIdentity) {
    return this.prisma.assessment.findMany({
      where: { caseId, organizationId: identity.organizationId },
      select: {
        id: true,
        caseId: true,
        status: true,
        purpose: true,
        requestedBy: true,
        requestedAt: true,
        completedAt: true,
        statusReasonCode: true,
      },
      orderBy: { requestedAt: "desc" },
    });
  }

  async get(id: string, identity: AiIdentity) {
    const result = await this.prisma.assessment.findFirst({
      where: { id, organizationId: identity.organizationId },
      include: {
        refs: true,
        prepared: {
          select: {
            id: true,
            byteCount: true,
            fingerprint: true,
            excludedRecords: true,
            preparedAt: true,
          },
        },
        executions: {
          select: {
            id: true,
            attemptNumber: true,
            adapterMode: true,
            mockProfile: true,
            providerExecutionId: true,
            status: true,
            submittedAt: true,
            completedAt: true,
            latencyMs: true,
            errorCode: true,
          },
          orderBy: { attemptNumber: "asc" },
        },
        output: {
          include: {
            findings: true,
            missingInformation: true,
            riskIndicators: true,
            citations: true,
          },
        },
        feedback: true,
        acceptances: { include: { items: true } },
        usage: true,
        failures: true,
      },
    });
    if (!result) throw new NotFoundException("Assessment not found.");
    return {
      ...result,
      refs: result.refs.map((ref) => ({
        ...ref,
        sizeBytes: ref.sizeBytes?.toString() ?? null,
      })),
    };
  }

  async cancel(id: string, identity: AiIdentity, correlationId: string) {
    const assessment = await this.get(id, identity);
    if (
      [
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
        "POLICY_BLOCKED",
        "INVALID_OUTPUT",
        "SUPERSEDED",
      ].includes(assessment.status)
    )
      throw new ConflictException("The assessment is already terminal.");
    return this.prisma.assessment
      .update({
        where: { id },
        data: {
          status:
            assessment.status === "QUEUED" ? "CANCELLED" : "CANCEL_REQUESTED",
          cancelledAt: assessment.status === "QUEUED" ? new Date() : null,
          rowVersion: { increment: 1 },
          statusReasonCode: "USER_CANCELLED",
        },
      })
      .then(async (updated) => {
        await this.emit(
          updated,
          "ai.assessment.cancellation-requested",
          correlationId,
          identity,
        );
        return updated;
      });
  }

  async feedback(
    id: string,
    input: z.infer<typeof feedbackSchema>,
    identity: AiIdentity,
  ) {
    const assessment = await this.get(id, identity);
    if (assessment.status !== "SUCCEEDED")
      throw new ConflictException(
        "Feedback is accepted only for a successful assessment.",
      );
    return this.prisma.assessmentFeedback.create({
      data: {
        assessmentId: id,
        actorId: identity.userId,
        rating: input.rating,
        comment: input.comment ?? null,
      },
    });
  }

  async accept(
    id: string,
    input: z.infer<typeof acceptanceSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const assessment = await this.get(id, identity);
    if (assessment.status !== "SUCCEEDED" || !assessment.output)
      throw new ConflictException(
        "Only a successful, current assessment can be accepted.",
      );
    const eligible = await this.dependencies.eligibility(
      identity.organizationId,
      identity.userId,
      "assessment:accept",
      correlationId,
    );
    if (!eligible.active || !eligible.eligible)
      throw new ForbiddenException(
        "The current actor is not eligible to accept assessment items.",
      );
    const available = new Set([
      ...assessment.output.findings.map((item) => `FINDING:${item.code}`),
      ...assessment.output.missingInformation.map(
        (item) => `MISSING_INFORMATION:${item.code}`,
      ),
      ...assessment.output.riskIndicators.map(
        (item) => `RISK_INDICATOR:${item.code}`,
      ),
    ]);
    if (
      input.selectedItems.some(
        (item) => !available.has(`${item.itemType}:${item.itemCode}`),
      )
    )
      throw new BadRequestException(
        "Every accepted item must belong to the normalized assessment output.",
      );
    const draft = await this.dependencies.workflowDraft(
      {
        organizationId: identity.organizationId,
        caseId: assessment.caseId,
        workflowInstanceId: assessment.workflowInstanceId,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
        assessmentId: assessment.id,
        actorId: identity.userId,
        selectedItems: input.selectedItems,
      },
      correlationId,
    );
    return this.prisma.assessmentAcceptance.create({
      data: {
        assessmentId: assessment.id,
        actorId: identity.userId,
        workflowDraftId: draft.draftId,
        items: { create: input.selectedItems },
      },
      include: { items: true },
    });
  }

  inputRefs(id: string, identity: AiIdentity) {
    return this.get(id, identity).then((assessment) => assessment.refs);
  }
  async executions(id: string, identity: AiIdentity) {
    await this.get(id, identity);
    const executions = await this.prisma.assessmentExecution.findMany({
      where: { assessmentId: id },
      orderBy: { attemptNumber: "asc" },
    });
    return executions.map(({ rawOutputEncrypted, ...safe }) => ({
      ...safe,
      rawOutputStoredEncrypted: Boolean(rawOutputEncrypted?.startsWith("v1.")),
    }));
  }

  governance(identity: AiIdentity) {
    return Promise.all([
      this.prisma.aiRuntimeConfig.findMany({
        where: {
          OR: [
            { organizationId: identity.organizationId },
            { organizationId: null },
          ],
        },
      }),
      this.prisma.modelPolicy.findMany({
        where: {
          OR: [
            { organizationId: identity.organizationId },
            { organizationId: null },
          ],
        },
      }),
      this.prisma.promptTemplate.findMany({
        where: {
          OR: [
            { organizationId: identity.organizationId },
            { organizationId: null },
          ],
        },
        include: { versions: true },
      }),
      this.prisma.redactionPolicy.findMany({
        where: {
          OR: [
            { organizationId: identity.organizationId },
            { organizationId: null },
          ],
        },
      }),
      this.prisma.aiKillSwitch.findMany({
        where: {
          OR: [
            { organizationId: identity.organizationId },
            { organizationId: null },
          ],
        },
      }),
    ]).then(
      ([
        runtimeConfigs,
        modelPolicies,
        promptTemplates,
        redactionPolicies,
        killSwitches,
      ]) => ({
        runtimeConfigs,
        modelPolicies,
        promptTemplates,
        redactionPolicies,
        killSwitches,
        adapterMode: getEnvironment().AI_ADAPTER_MODE,
        liveCortex: "DEFERRED_UNVERIFIED",
      }),
    );
  }

  async createRuntime(
    input: z.infer<typeof runtimeConfigSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const created = await this.prisma.aiRuntimeConfig.create({
      data: {
        ...input,
        organizationId: identity.organizationId,
        createdBy: identity.userId,
      },
    });
    await this.emitGovernance(
      created.id,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      { configurationId: created.id, action: "CREATED" },
    );
    return created;
  }
  async createPolicy(
    input: z.infer<typeof modelPolicySchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const created = await this.prisma.modelPolicy.create({
      data: {
        ...input,
        organizationId: identity.organizationId,
        allowedClassifications: json(input.allowedClassifications),
        allowedMediaTypes: json(input.allowedMediaTypes),
        createdBy: identity.userId,
      },
    });
    await this.emitGovernance(
      created.id,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      { modelPolicyId: created.id, action: "CREATED" },
    );
    return created;
  }
  async createTemplate(
    input: z.infer<typeof promptTemplateSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const created = await this.prisma.promptTemplate.create({
      data: {
        ...input,
        organizationId: identity.organizationId,
        createdBy: identity.userId,
      },
    });
    await this.emitGovernance(
      created.id,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      { promptTemplateId: created.id, action: "CREATED" },
    );
    return created;
  }
  async createPromptVersion(
    templateId: string,
    input: z.infer<typeof promptVersionSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const template = await this.prisma.promptTemplate.findFirst({
      where: { id: templateId, organizationId: identity.organizationId },
    });
    if (!template) throw new NotFoundException("Prompt template not found.");
    const latest = await this.prisma.promptTemplateVersion.aggregate({
      where: { promptTemplateId: templateId },
      _max: { versionNumber: true },
    });
    const created = await this.prisma.promptTemplateVersion.create({
      data: {
        promptTemplateId: templateId,
        versionNumber: (latest._max.versionNumber ?? 0) + 1,
        systemPrompt: input.systemPrompt,
        outputSchema: json({
          contract: "cdep.ai.assessment-output",
          version: "1.0",
        }),
        createdBy: identity.userId,
      },
    });
    await this.emitGovernance(
      created.id,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      {
        promptTemplateId: templateId,
        promptVersionId: created.id,
        action: "DRAFT_CREATED",
      },
    );
    return created;
  }
  async publishPromptVersion(
    id: string,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const version = await this.tenantPromptVersion(id, identity.organizationId);
    if (version.status !== "DRAFT")
      throw new ConflictException(
        "Only a draft prompt version can be published.",
      );
    const updated = await this.prisma.promptTemplateVersion.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        publishedBy: identity.userId,
        publishedAt: new Date(),
      },
    });
    await this.emitGovernance(
      updated.id,
      identity.organizationId,
      "ai.governance.prompt.published",
      correlationId,
      identity.userId,
      {
        promptTemplateId: updated.promptTemplateId,
        promptVersionId: updated.id,
      },
    );
    return updated;
  }
  async retirePromptVersion(
    id: string,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const version = await this.tenantPromptVersion(id, identity.organizationId);
    if (version.status !== "PUBLISHED")
      throw new ConflictException(
        "Only a published prompt version can be retired.",
      );
    const updated = await this.prisma.promptTemplateVersion.update({
      where: { id },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
    await this.emitGovernance(
      updated.id,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      {
        promptTemplateId: updated.promptTemplateId,
        promptVersionId: updated.id,
        action: "RETIRED",
      },
    );
    return updated;
  }
  async setKillSwitch(
    input: z.infer<typeof killSwitchSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const organizationId = identity.organizationId;
    const existing = await this.prisma.aiKillSwitch.findFirst({
      where: { organizationId, scope: input.scope },
    });
    const updated = !existing
      ? await this.prisma.aiKillSwitch.create({
          data: {
            organizationId,
            scope: input.scope,
            enabled: input.enabled,
            reason: input.reason ?? null,
            updatedBy: identity.userId,
          },
        })
      : await this.prisma.aiKillSwitch.update({
          where: { id: existing.id },
          data: {
            enabled: input.enabled,
            reason: input.reason ?? null,
            updatedBy: identity.userId,
          },
        });
    await this.emitGovernance(
      updated.id,
      organizationId,
      "ai.governance.kill_switch.changed",
      correlationId,
      identity.userId,
      {
        killSwitchId: updated.id,
        scope: updated.scope,
        enabled: updated.enabled,
      },
    );
    return updated;
  }

  async runtimeConfigurations(identity: AiIdentity) {
    return this.prisma.aiRuntimeConfig.findMany({
      where: {
        OR: [
          { organizationId: identity.organizationId },
          { organizationId: null },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateRuntime(
    id: string,
    input: z.infer<typeof runtimeConfigPatchSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const current = await this.prisma.aiRuntimeConfig.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!current)
      throw new NotFoundException("Runtime configuration not found.");
    if (
      input.expectedUpdatedAt &&
      current.updatedAt.toISOString() !== input.expectedUpdatedAt
    )
      throw new ConflictException("The runtime configuration has changed.");
    const { expectedUpdatedAt: _, ...changes } = input;
    const data: Prisma.AiRuntimeConfigUpdateInput = {};
    if (changes.mockProfile !== undefined)
      data.mockProfile = changes.mockProfile;
    if (changes.enabled !== undefined) data.enabled = changes.enabled;
    if (changes.maxInputBytes !== undefined)
      data.maxInputBytes = changes.maxInputBytes;
    if (changes.maxEvidenceItems !== undefined)
      data.maxEvidenceItems = changes.maxEvidenceItems;
    if (changes.timeoutMs !== undefined) data.timeoutMs = changes.timeoutMs;
    if (changes.retryLimit !== undefined) data.retryLimit = changes.retryLimit;
    const updated = await this.prisma.aiRuntimeConfig.update({
      where: { id },
      data,
    });
    await this.emitGovernance(
      id,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      { configurationId: id, action: "UPDATED" },
    );
    return updated;
  }

  async testRuntime(id: string, identity: AiIdentity, correlationId: string) {
    const configuration = await this.prisma.aiRuntimeConfig.findFirst({
      where: {
        id,
        OR: [
          { organizationId: identity.organizationId },
          { organizationId: null },
        ],
      },
    });
    if (!configuration)
      throw new NotFoundException("Runtime configuration not found.");
    const started = Date.now();
    const result = await this.cortex.testConnection(
      { correlationId },
      AbortSignal.timeout(Math.min(configuration.timeoutMs, 5_000)),
    );
    return {
      ...result,
      status: "AVAILABLE",
      latencyCategory: Date.now() - started < 250 ? "LOW" : "BOUNDED",
      warning: "Synthetic mock self-test; Cortex is not connected.",
    };
  }

  modelPolicies(identity: AiIdentity) {
    return this.prisma.modelPolicy.findMany({
      where: {
        OR: [
          { organizationId: identity.organizationId },
          { organizationId: null },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updatePolicy(
    id: string,
    input: z.infer<typeof modelPolicyPatchSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const current = await this.prisma.modelPolicy.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!current) throw new NotFoundException("Model policy not found.");
    if (
      input.expectedUpdatedAt &&
      current.updatedAt.toISOString() !== input.expectedUpdatedAt
    )
      throw new ConflictException("The model policy has changed.");
    const {
      expectedUpdatedAt: _,
      allowedClassifications,
      allowedMediaTypes,
      ...rest
    } = input;
    const updated = await this.prisma.modelPolicy.update({
      where: { id },
      data: {
        ...(rest.runtimeConfigId !== undefined
          ? { runtimeConfigId: rest.runtimeConfigId }
          : {}),
        ...(rest.promptTemplateVersionId !== undefined
          ? { promptTemplateVersionId: rest.promptTemplateVersionId }
          : {}),
        ...(rest.purpose !== undefined ? { purpose: rest.purpose } : {}),
        ...(rest.enabled !== undefined ? { enabled: rest.enabled } : {}),
        ...(allowedClassifications
          ? { allowedClassifications: json(allowedClassifications) }
          : {}),
        ...(allowedMediaTypes
          ? { allowedMediaTypes: json(allowedMediaTypes) }
          : {}),
      },
    });
    await this.emitGovernance(
      id,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      { modelPolicyId: id, action: "UPDATED" },
    );
    return updated;
  }

  promptTemplates(identity: AiIdentity) {
    return this.prisma.promptTemplate.findMany({
      where: {
        OR: [
          { organizationId: identity.organizationId },
          { organizationId: null },
        ],
      },
      include: { versions: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async updatePromptVersion(
    templateId: string,
    versionId: string,
    input: z.infer<typeof promptVersionPatchSchema>,
    identity: AiIdentity,
    correlationId: string,
  ) {
    const version = await this.tenantPromptVersion(
      versionId,
      identity.organizationId,
      templateId,
    );
    if (version.status !== "DRAFT")
      throw new ConflictException(
        "Published and retired prompt versions are immutable.",
      );
    const updated = await this.prisma.promptTemplateVersion.update({
      where: { id: versionId },
      data: {
        ...(input.systemPrompt !== undefined
          ? { systemPrompt: input.systemPrompt }
          : {}),
      },
    });
    await this.emitGovernance(
      versionId,
      identity.organizationId,
      "ai.governance.configuration.changed",
      correlationId,
      identity.userId,
      {
        promptTemplateId: templateId,
        promptVersionId: versionId,
        action: "DRAFT_UPDATED",
      },
    );
    return updated;
  }

  async operations(identity: AiIdentity) {
    const [queue, failures] = await Promise.all([
      this.prisma.assessment.findMany({
        where: {
          organizationId: identity.organizationId,
          status: {
            in: [
              "QUEUED",
              "PREPARING_INPUT",
              "READY_FOR_INFERENCE",
              "SUBMITTED",
              "RUNNING",
              "VALIDATING_OUTPUT",
              "FAILED",
              "INVALID_OUTPUT",
              "POLICY_BLOCKED",
            ],
          },
        },
        select: {
          id: true,
          caseId: true,
          status: true,
          statusReasonCode: true,
          requestedAt: true,
          startedAt: true,
          completedAt: true,
        },
        orderBy: { requestedAt: "desc" },
        take: 100,
      }),
      this.prisma.assessmentFailure.findMany({
        where: { assessment: { organizationId: identity.organizationId } },
        select: {
          id: true,
          assessmentId: true,
          attemptNumber: true,
          code: true,
          retryable: true,
          occurredAt: true,
        },
        orderBy: { occurredAt: "desc" },
        take: 100,
      }),
    ]);
    return { queue, failures };
  }

  async retryFailure(id: string, identity: AiIdentity) {
    const failure = await this.prisma.assessmentFailure.findFirst({
      where: { id, assessment: { organizationId: identity.organizationId } },
    });
    if (!failure) throw new NotFoundException("Operational failure not found.");
    if (!failure.retryable)
      throw new ConflictException("The operational failure is not retryable.");
    return this.retry(failure.assessmentId, identity);
  }

  async retryOperationTarget(id: string, identity: AiIdentity) {
    const failure = await this.prisma.assessmentFailure.findFirst({
      where: { id, assessment: { organizationId: identity.organizationId } },
    });
    return failure ? this.retryFailure(id, identity) : this.retry(id, identity);
  }

  private async tenantPromptVersion(
    id: string,
    organizationId: string,
    templateId?: string,
  ) {
    const version = await this.prisma.promptTemplateVersion.findFirst({
      where: {
        id,
        ...(templateId ? { promptTemplateId: templateId } : {}),
        template: { organizationId },
      },
    });
    if (!version) throw new NotFoundException("Prompt version not found.");
    return version;
  }
  async retry(id: string, identity: AiIdentity) {
    const assessment = await this.get(id, identity);
    if (
      !["FAILED", "INVALID_OUTPUT", "POLICY_BLOCKED"].includes(
        assessment.status,
      )
    )
      throw new ConflictException("Only a failed assessment can be retried.");
    return this.prisma
      .$transaction([
        this.prisma.assessment.update({
          where: { id },
          data: {
            status: "QUEUED",
            statusReasonCode: null,
            completedAt: null,
            rowVersion: { increment: 1 },
          },
        }),
        this.prisma.assessmentJobLease.upsert({
          where: { assessmentId: id },
          create: {
            assessmentId: id,
            owner: "unleased",
            expiresAt: new Date(0),
          },
          update: {
            owner: "unleased",
            expiresAt: new Date(0),
            nextAttemptAt: null,
          },
        }),
      ])
      .then(([updated]) => updated);
  }

  private async emit(
    assessment: {
      id: string;
      organizationId: string;
      caseId: string;
      rowVersion: number;
    },
    eventType: string,
    correlationId: string,
    identity: AiIdentity,
  ) {
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: "Assessment",
        aggregateId: assessment.id,
        aggregateVersion: assessment.rowVersion,
        eventType,
        eventVersion: "1.0",
        payload: json({
          assessmentId: assessment.id,
          caseId: assessment.caseId,
        }),
        correlationId,
        organizationId: assessment.organizationId,
        actorType: "USER",
        actorId: identity.userId,
      },
    });
  }

  private async emitGovernance(
    aggregateId: string,
    organizationId: string,
    eventType: string,
    correlationId: string,
    actorId: string,
    payload: Record<string, unknown>,
  ) {
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: "AiGovernance",
        aggregateId,
        aggregateVersion: 1,
        eventType,
        eventVersion: "1.0",
        payload: json(payload),
        correlationId,
        organizationId,
        actorType: "USER",
        actorId,
      },
    });
  }
}
