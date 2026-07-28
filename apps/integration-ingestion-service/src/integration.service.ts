import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { JSONPath } from "jsonpath-plus";
import {
  Prisma,
  type ConnectorDefinition,
  type SourceTrigger,
} from "@cdep/integration-prisma-client";
import {
  canonicalTriggerEventSchema,
  evidenceReferenceProjectionSchema,
} from "@cdep/contracts";
import { PrismaService } from "./prisma.service.js";
import { SecretProtector } from "./secret-protector.js";
import { env } from "./environment.js";
import {
  PostgresSqlPollingAdapter,
  type PostgresPollingConfig,
  type ResolvedCredential,
} from "./sql-polling.adapter.js";

export type Identity = {
  userId: string;
  organizationId: string;
  permissions: string[];
};
const triggerTypePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const extractionTargets = new Set([
  "businessReference",
  "externalCaseReference",
  "subjectType",
  "subjectId",
  "occurredAt",
  "sourceRecordId",
  "classificationCode",
  "title",
  "externalReference",
  "description",
]);
const extractionTransforms = new Set([
  "TRIM",
  "LOWERCASE",
  "UPPERCASE",
  "STRING",
  "ISO_DATETIME",
]);

@Injectable()
export class IntegrationService {
  private readonly environment = env();
  constructor(
    private readonly db: PrismaService,
    private readonly secrets: SecretProtector,
    private readonly postgres: PostgresSqlPollingAdapter,
  ) {}

  async createSource(body: any, identity: Identity, correlationId: string) {
    if (!body?.code || !body?.name)
      throw new BadRequestException("Code and name are required.");
    return this.db.$transaction(async (tx) => {
      const source = await tx.sourceSystem.create({
        data: {
          organizationId: identity.organizationId,
          code: String(body.code).trim().toUpperCase(),
          name: String(body.name).trim(),
          ...(body.description == null
            ? {}
            : { description: String(body.description) }),
          createdBy: identity.userId,
          updatedBy: identity.userId,
        },
      });
      await this.lifecycle(
        tx,
        identity.organizationId,
        source.id,
        correlationId,
        "integration.source.created",
        { sourceId: source.id },
      );
      return source;
    });
  }
  listSources(identity: Identity) {
    return this.db.sourceSystem.findMany({
      where: { organizationId: identity.organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }
  async getSource(id: string, identity: Identity) {
    const source = await this.db.sourceSystem.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!source) throw new NotFoundException("Source system not found.");
    return source;
  }
  async updateSource(id: string, body: any, identity: Identity) {
    const current = await this.getSource(id, identity);
    if (body.version !== current.version)
      throw new ConflictException("Stale source-system version.");
    if (
      current.status !== "DRAFT" &&
      body.code &&
      String(body.code).toUpperCase() !== current.code
    )
      throw new ConflictException("An activated source code is immutable.");
    return this.db.sourceSystem.update({
      where: { id },
      data: {
        ...(body.name === undefined ? {} : { name: String(body.name).trim() }),
        ...(body.description === undefined
          ? {}
          : { description: body.description }),
        version: { increment: 1 },
        updatedBy: identity.userId,
      },
    });
  }
  async sourceStatus(
    id: string,
    status: "ACTIVE" | "SUSPENDED",
    identity: Identity,
  ) {
    await this.getSource(id, identity);
    return this.db.sourceSystem.update({
      where: { id },
      data: { status, version: { increment: 1 }, updatedBy: identity.userId },
    });
  }

  async createConnector(sourceId: string, body: any, identity: Identity) {
    await this.getSource(sourceId, identity);
    if (!["WEBHOOK", "SQL_POLL"].includes(body.type))
      throw new BadRequestException(
        "Connector type must be WEBHOOK or SQL_POLL.",
      );
    if (!triggerTypePattern.test(String(body.triggerType ?? "")))
      throw new BadRequestException(
        "Trigger type must be a lowercase dotted name.",
      );
    const configuration =
      body.type === "SQL_POLL"
        ? this.postgres.validateConfiguration({
            ...body.configuration,
            batchSize:
              body.configuration?.batchSize ??
              this.environment.SQL_POLL_DEFAULT_BATCH_SIZE,
          })
        : this.validateWebhookConfiguration(body.configuration);
    return this.db.connectorDefinition.create({
      data: {
        organizationId: identity.organizationId,
        sourceSystemId: sourceId,
        name: String(body.name).trim(),
        type: body.type,
        triggerType: body.triggerType,
        configurationJson: configuration as Prisma.InputJsonValue,
        pollIntervalSeconds:
          body.type === "SQL_POLL"
            ? (configuration as PostgresPollingConfig).pollIntervalSeconds
            : null,
        batchSize:
          body.type === "SQL_POLL"
            ? (configuration as PostgresPollingConfig).batchSize
            : null,
        createdBy: identity.userId,
        updatedBy: identity.userId,
      },
    });
  }
  async listConnectors(sourceId: string, identity: Identity) {
    const connectors = await this.db.connectorDefinition.findMany({
      where: {
        sourceSystemId: sourceId,
        organizationId: identity.organizationId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return connectors.map((connector) => this.sanitizeConnector(connector));
  }
  async getConnector(id: string, identity: Identity) {
    const connector = await this.db.connectorDefinition.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!connector) throw new NotFoundException("Connector not found.");
    return this.sanitizeConnector(connector);
  }
  private async connectorRecord(id: string, organizationId: string) {
    const connector = await this.db.connectorDefinition.findFirst({
      where: { id, organizationId },
    });
    if (!connector) throw new NotFoundException("Connector not found.");
    return connector;
  }
  async updateConnector(id: string, body: any, identity: Identity) {
    const current = await this.connectorRecord(id, identity.organizationId);
    if (body.version !== current.version)
      throw new ConflictException("Stale connector version.");
    if (current.status === "ACTIVE" && body.type && body.type !== current.type)
      throw new ConflictException("An active connector type is immutable.");
    const triggerType = body.triggerType ?? current.triggerType;
    if (!triggerTypePattern.test(triggerType))
      throw new BadRequestException(
        "Trigger type must be a lowercase dotted name.",
      );
    const configuration =
      body.configuration === undefined
        ? undefined
        : current.type === "SQL_POLL"
          ? this.postgres.validateConfiguration(body.configuration)
          : this.validateWebhookConfiguration(body.configuration);
    return this.db.connectorDefinition.update({
      where: { id },
      data: {
        ...(body.name === undefined ? {} : { name: String(body.name).trim() }),
        triggerType,
        ...(configuration === undefined
          ? {}
          : { configurationJson: configuration as Prisma.InputJsonValue }),
        ...(current.type === "SQL_POLL" && configuration
          ? {
              pollIntervalSeconds: (configuration as PostgresPollingConfig)
                .pollIntervalSeconds,
              batchSize: (configuration as PostgresPollingConfig).batchSize,
            }
          : {}),
        version: { increment: 1 },
        updatedBy: identity.userId,
      },
    });
  }
  async putCredential(id: string, body: any, identity: Identity) {
    const current = await this.connectorRecord(id, identity.organizationId);
    const protectedCredential =
      this.environment.CONNECTOR_SECRET_PROVIDER === "external"
        ? (() => {
            try {
              if (typeof body?.secretRef !== "string") throw new Error();
              return this.secrets.reference(body.secretRef);
            } catch {
              throw new BadRequestException(
                "A file:/run/secrets/<name> external secret reference is required.",
              );
            }
          })()
        : (() => {
            if (typeof body?.value !== "string" || body.value.length < 16)
              throw new BadRequestException(
                "A credential value of at least 16 characters is required.",
              );
            if (current.type === "SQL_POLL")
              this.parseSqlCredential(body.value);
            return this.secrets.encrypt(body.value);
          })();
    const credential = await this.db.$transaction(async (tx) => {
      const created = await tx.connectorCredential.create({
        data: {
          organizationId: identity.organizationId,
          ...protectedCredential,
        },
      });
      await tx.connectorDefinition.update({
        where: { id },
        data: {
          credentialId: created.id,
          version: { increment: 1 },
          updatedBy: identity.userId,
        },
      });
      if (current.credentialId)
        await tx.connectorCredential.delete({
          where: { id: current.credentialId },
        });
      return created;
    });
    return {
      configured: true,
      provider: credential.provider,
      keyId: credential.keyId,
      rotatedAt: credential.rotatedAt,
    };
  }
  async testConnector(id: string, identity: Identity) {
    const connector = await this.connectorRecord(id, identity.organizationId);
    if (!connector.credentialId)
      return {
        ok: false,
        code: "CREDENTIAL_REQUIRED",
        checkedAt: new Date().toISOString(),
      };
    if (connector.type === "SQL_POLL") {
      await this.postgres.testConnection(
        this.postgres.validateConfiguration(connector.configurationJson),
        await this.resolveSqlCredential(connector),
      );
    }
    return {
      ok: true,
      code: "CONNECTION_OK",
      checkedAt: new Date().toISOString(),
    };
  }
  async connectorStatus(
    id: string,
    status: "ACTIVE" | "PAUSED",
    identity: Identity,
  ) {
    const connector = await this.connectorRecord(id, identity.organizationId);
    if (status === "ACTIVE") {
      if (!connector.credentialId)
        throw new UnprocessableEntityException(
          "Connector credentials are required.",
        );
      if (!triggerTypePattern.test(connector.triggerType))
        throw new UnprocessableEntityException(
          "A valid trigger type is required.",
        );
      if (connector.type === "SQL_POLL")
        this.postgres.validateConfiguration(connector.configurationJson);
    }
    return this.db.connectorDefinition.update({
      where: { id },
      data: {
        status,
        ...(connector.type === "SQL_POLL"
          ? { nextRunAt: status === "ACTIVE" ? new Date() : null }
          : {}),
        version: { increment: 1 },
        updatedBy: identity.userId,
      },
    });
  }

  getExtractionRules(id: string, identity: Identity) {
    return this.db.fieldExtractionRule.findMany({
      where: { connectorId: id, organizationId: identity.organizationId },
      orderBy: { targetField: "asc" },
    });
  }
  async putExtractionRules(id: string, rules: any[], identity: Identity) {
    await this.connectorRecord(id, identity.organizationId);
    if (!Array.isArray(rules))
      throw new BadRequestException("Extraction rules must be an array.");
    const targets = new Set<string>();
    for (const rule of rules) {
      if (
        !extractionTargets.has(rule.targetField) ||
        targets.has(rule.targetField)
      )
        throw new BadRequestException(
          "Unsupported or duplicate extraction target.",
        );
      if (
        typeof rule.sourcePath !== "string" ||
        !rule.sourcePath.startsWith("$")
      )
        throw new BadRequestException("A safe JSONPath is required.");
      if (rule.transform && !extractionTransforms.has(rule.transform))
        throw new BadRequestException("Unsupported extraction transform.");
      targets.add(rule.targetField);
    }
    return this.db.$transaction(async (tx) => {
      await tx.fieldExtractionRule.deleteMany({
        where: { connectorId: id, organizationId: identity.organizationId },
      });
      for (const rule of rules)
        await tx.fieldExtractionRule.create({
          data: {
            organizationId: identity.organizationId,
            connectorId: id,
            targetField: rule.targetField,
            sourcePath: rule.sourcePath,
            required: Boolean(rule.required),
            ...(rule.defaultValue == null
              ? {}
              : { defaultValue: String(rule.defaultValue) }),
            ...(rule.transform ? { transform: rule.transform } : {}),
          },
        });
      return tx.fieldExtractionRule.findMany({
        where: { connectorId: id, organizationId: identity.organizationId },
        orderBy: { targetField: "asc" },
      });
    });
  }
  async testExtraction(id: string, sample: unknown, identity: Identity) {
    const rules = await this.getExtractionRules(id, identity);
    return this.extract(sample, rules);
  }
  async getCorrelationRules(id: string, identity: Identity) {
    await this.connectorRecord(id, identity.organizationId);
    return this.db.correlationRuleSet.findUnique({
      where: { connectorId: id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
  }
  async putCorrelationRules(id: string, body: any, identity: Identity) {
    await this.connectorRecord(id, identity.organizationId);
    if (
      !["BUSINESS_REFERENCE_EQUALS", "EXTERNAL_REFERENCE_EQUALS"].includes(
        body.ruleType,
      )
    )
      throw new BadRequestException("Unsupported correlation rule.");
    if (body.ruleType === "EXTERNAL_REFERENCE_EQUALS" && !body.referenceType)
      throw new BadRequestException("referenceType is required.");
    return this.db.$transaction(async (tx) => {
      const set = await tx.correlationRuleSet.upsert({
        where: { connectorId: id },
        update: { name: body.name ?? "Case correlation" },
        create: {
          organizationId: identity.organizationId,
          connectorId: id,
          name: body.name ?? "Case correlation",
        },
      });
      const latest = await tx.correlationRuleVersion.aggregate({
        where: { ruleSetId: set.id },
        _max: { version: true },
      });
      const version = await tx.correlationRuleVersion.create({
        data: {
          organizationId: identity.organizationId,
          ruleSetId: set.id,
          version: (latest._max.version ?? 0) + 1,
          ruleType: body.ruleType,
          ...(body.referenceType ? { referenceType: body.referenceType } : {}),
          createdBy: identity.userId,
        },
      });
      return { ...set, version };
    });
  }

  async publicWebhookContext(connectorKey: string) {
    const connector = await this.db.connectorDefinition.findUnique({
      where: { connectorKey },
      include: { sourceSystem: true },
    });
    if (
      !connector ||
      connector.type !== "WEBHOOK" ||
      connector.status !== "ACTIVE" ||
      connector.sourceSystem.status !== "ACTIVE" ||
      !connector.credentialId
    )
      throw new NotFoundException("Webhook connector not found.");
    const secret = await this.resolveCredential(connector);
    return { connector, source: connector.sourceSystem, secret };
  }
  async acceptWebhook(
    context: Awaited<ReturnType<IntegrationService["publicWebhookContext"]>>,
    sourceRecordId: string | undefined,
    rawBody: Buffer,
    payload: unknown,
    correlationId: string,
  ) {
    if (payload === null || typeof payload !== "object")
      throw new BadRequestException("A JSON object or array is required.");
    const hash = createHash("sha256").update(rawBody).digest("hex");
    const idempotencyKey = sourceRecordId ? `webhook:${sourceRecordId}` : null;
    if (idempotencyKey) {
      const existing = await this.db.sourceTrigger.findUnique({
        where: {
          organizationId_connectorId_idempotencyKey: {
            organizationId: context.connector.organizationId,
            connectorId: context.connector.id,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.payloadSha256 !== hash)
          throw new ConflictException("SOURCE_ID_PAYLOAD_CONFLICT");
        return this.receipt(existing);
      }
    }
    let trigger: SourceTrigger;
    try {
      trigger = await this.db.$transaction(async (tx) => {
        const created = await tx.sourceTrigger.create({
          data: {
            organizationId: context.connector.organizationId,
            sourceSystemId: context.source.id,
            connectorId: context.connector.id,
            connectorType: "WEBHOOK",
            triggerType: context.connector.triggerType,
            ...(sourceRecordId ? { sourceRecordId } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            payloadJson: payload as Prisma.InputJsonValue,
            payloadSha256: hash,
            metadataJson: { adapter: "WEBHOOK" },
            correlationId,
          },
        });
        await tx.processingAttempt.create({
          data: {
            organizationId: created.organizationId,
            sourceTriggerId: created.id,
            stage: "CAPTURE",
            outcome: "SUCCEEDED",
          },
        });
        return created;
      });
    } catch (error) {
      if (
        !idempotencyKey ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      const concurrent = await this.db.sourceTrigger.findUnique({
        where: {
          organizationId_connectorId_idempotencyKey: {
            organizationId: context.connector.organizationId,
            connectorId: context.connector.id,
            idempotencyKey,
          },
        },
      });
      if (!concurrent) throw error;
      if (concurrent.payloadSha256 !== hash) {
        throw new ConflictException("SOURCE_ID_PAYLOAD_CONFLICT");
      }
      return this.receipt(concurrent);
    }
    await this.processTrigger(trigger.id);
    return this.receipt(trigger);
  }

  async runConnector(id: string, key: string | undefined, identity: Identity) {
    const connector = await this.connectorRecord(id, identity.organizationId);
    if (connector.type !== "SQL_POLL")
      throw new BadRequestException(
        "Run-now is available only for SQL polling connectors.",
      );
    if (connector.status !== "ACTIVE")
      throw new ConflictException("Connector is not active.");
    const storedKey = key ? `run:${id}:${key}` : undefined;
    if (storedKey) {
      const previous = await this.db.idempotencyRecord.findUnique({
        where: {
          organizationId_key: {
            organizationId: identity.organizationId,
            key: storedKey,
          },
        },
      });
      if (previous) return previous.responseJson;
    }
    const leaseOwnerId = await this.acquireLease(connector);
    const checkpoint = await this.db.connectorCheckpoint.findUnique({
      where: { connectorId: id },
    });
    let run;
    try {
      run = await this.db.ingestionRun.create({
        data: {
          organizationId: identity.organizationId,
          connectorId: id,
          status: "RUNNING",
          checkpointBefore: checkpoint
            ? {
                watermark: checkpoint.watermark,
                tieBreaker: checkpoint.tieBreaker,
              }
            : Prisma.JsonNull,
        },
      });
    } catch (error) {
      await this.releaseLease(id, leaseOwnerId);
      throw error;
    }
    try {
      const result = await this.postgres.poll(
        this.postgres.validateConfiguration(connector.configurationJson),
        await this.resolveSqlCredential(connector),
        checkpoint
          ? {
              watermark: checkpoint.watermark,
              tieBreaker: checkpoint.tieBreaker,
            }
          : null,
      );
      const captured = await this.db.$transaction(async (tx) => {
        const triggerIds: string[] = [];
        for (const candidate of result.rows) {
          const metadata = candidate.metadata;
          const idempotencyKey = `sql:${candidate.sourceRecordId}:${metadata.watermark}:${metadata.tieBreaker}`;
          const bytes = Buffer.from(JSON.stringify(candidate.payload));
          const trigger = await tx.sourceTrigger.upsert({
            where: {
              organizationId_connectorId_idempotencyKey: {
                organizationId: connector.organizationId,
                connectorId: connector.id,
                idempotencyKey,
              },
            },
            update: {},
            create: {
              organizationId: connector.organizationId,
              sourceSystemId: connector.sourceSystemId,
              connectorId: connector.id,
              connectorType: "SQL_POLL",
              triggerType: connector.triggerType,
              sourceRecordId: candidate.sourceRecordId,
              idempotencyKey,
              ...(candidate.occurredAt
                ? { occurredAt: new Date(candidate.occurredAt) }
                : {}),
              payloadJson: candidate.payload as Prisma.InputJsonValue,
              payloadSha256: createHash("sha256").update(bytes).digest("hex"),
              metadataJson: metadata,
              correlationId: randomUUID(),
            },
          });
          triggerIds.push(trigger.id);
        }
        if (result.nextCheckpoint)
          await tx.connectorCheckpoint.upsert({
            where: { connectorId: id },
            update: {
              watermark: result.nextCheckpoint.watermark,
              tieBreaker: result.nextCheckpoint.tieBreaker,
            },
            create: {
              connectorId: id,
              organizationId: connector.organizationId,
              watermark: result.nextCheckpoint.watermark,
              tieBreaker: result.nextCheckpoint.tieBreaker,
            },
          });
        await tx.ingestionRun.update({
          where: { id: run.id },
          data: {
            status: "SUCCEEDED",
            rowsCaptured: triggerIds.length,
            completedAt: new Date(),
            checkpointAfter: (result.nextCheckpoint as any) ?? Prisma.JsonNull,
          },
        });
        await tx.connectorDefinition.update({
          where: { id },
          data: {
            lastSuccessAt: new Date(),
            lastErrorCode: null,
            consecutiveFailureCount: 0,
            nextRunAt: new Date(
              Date.now() + (connector.pollIntervalSeconds ?? 60) * 1000,
            ),
          },
        });
        await tx.connectorLease.deleteMany({
          where: { connectorId: id, ownerId: leaseOwnerId },
        });
        return triggerIds;
      });
      for (const triggerId of captured) await this.processTrigger(triggerId);
      const completed = await this.db.ingestionRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      if (storedKey)
        await this.db.idempotencyRecord.create({
          data: {
            organizationId: identity.organizationId,
            key: storedKey,
            responseJson: completed,
          },
        });
      return completed;
    } catch (error) {
      await this.recordPollFailure(connector, run.id, leaseOwnerId);
      throw error;
    }
  }

  async runDueConnectors() {
    const now = new Date();
    const due = await this.db.connectorDefinition.findMany({
      where: {
        type: "SQL_POLL",
        status: "ACTIVE",
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: 20,
    });
    for (const connector of due) {
      const nextRunAt = new Date(
        Date.now() + (connector.pollIntervalSeconds ?? 60) * 1000,
      );
      const claimed = await this.db.connectorDefinition.updateMany({
        where: {
          id: connector.id,
          status: "ACTIVE",
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        data: { nextRunAt },
      });
      if (claimed.count !== 1) continue;
      try {
        await this.runConnector(
          connector.id,
          `scheduled:${now.toISOString()}`,
          {
            organizationId: connector.organizationId,
            userId: connector.updatedBy,
            permissions: ["integration:connector:run"],
          },
        );
      } catch {
        // The run record, retry schedule, failure count, and automatic pause are
        // maintained by runConnector/recordPollFailure.
      }
    }
  }

  async processTrigger(id: string) {
    const trigger = await this.db.sourceTrigger.findUnique({ where: { id } });
    if (!trigger || trigger.status === "PUBLISHED") return trigger;
    const rules = await this.db.fieldExtractionRule.findMany({
      where: { connectorId: trigger.connectorId },
      orderBy: { targetField: "asc" },
    });
    const extraction = this.extract(trigger.payloadJson, rules);
    if (!extraction.valid) {
      await this.failTrigger(
        trigger,
        "EXTRACTION_FAILED",
        extraction.errors.join("; "),
      );
      return;
    }
    await this.db.sourceTrigger.update({
      where: { id },
      data: {
        extractedFieldsJson: extraction.fields as Prisma.InputJsonValue,
        status: "CORRELATION_PENDING",
        processingAttemptCount: { increment: 1 },
      },
    });
    const ruleSet = await this.db.correlationRuleSet.findUnique({
      where: { connectorId: trigger.connectorId },
      include: {
        versions: {
          where: { status: "PUBLISHED" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });
    if (!ruleSet?.versions[0]) {
      await this.emitCanonical(
        trigger,
        extraction.fields,
        null,
        "NOT_CONFIGURED",
        null,
      );
      return;
    }
    const rule = ruleSet.versions[0];
    const value =
      rule.ruleType === "BUSINESS_REFERENCE_EQUALS"
        ? extraction.fields.businessReference
        : extraction.fields.externalCaseReference;
    if (!value) {
      await this.markCorrelation(
        trigger,
        "UNMATCHED",
        rule.id,
        extraction.fields,
        null,
      );
      return;
    }
    try {
      const response = await fetch(
        `${this.environment.CASE_SERVICE_URL}/internal/v1/cases/resolve-correlation`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-cdep-internal-service-token":
              this.environment.INTERNAL_SERVICE_TOKEN,
            "x-correlation-id": trigger.correlationId,
          },
          body: JSON.stringify({
            organizationId: trigger.organizationId,
            sourceSystemId: trigger.sourceSystemId,
            ruleType: rule.ruleType,
            referenceType: rule.referenceType,
            referenceValue: String(value),
          }),
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!response.ok) throw new Error("CASE_CORRELATION_UNAVAILABLE");
      const result = (await response.json()) as {
        matches: Array<{ caseId: string }>;
      };
      if (result.matches.length === 0)
        await this.markCorrelation(
          trigger,
          "UNMATCHED",
          rule.id,
          extraction.fields,
          null,
        );
      else if (result.matches.length > 1)
        await this.markCorrelation(
          trigger,
          "AMBIGUOUS_CORRELATION",
          rule.id,
          extraction.fields,
          null,
        );
      else
        await this.emitCanonical(
          trigger,
          extraction.fields,
          result.matches[0]!.caseId,
          "MATCHED",
          rule.id,
        );
    } catch {
      await this.failTrigger(
        trigger,
        "CASE_CORRELATION_UNAVAILABLE",
        "Case correlation could not be completed.",
      );
    }
  }

  listTriggers(identity: Identity, query: any) {
    return this.db.sourceTrigger.findMany({
      where: {
        organizationId: identity.organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.connectorId ? { connectorId: query.connectorId } : {}),
      },
      select: {
        id: true,
        sourceSystemId: true,
        connectorId: true,
        connectorType: true,
        triggerType: true,
        sourceRecordId: true,
        occurredAt: true,
        receivedAt: true,
        payloadSha256: true,
        extractedFieldsJson: true,
        caseId: true,
        status: true,
        correlationId: true,
        lastErrorCode: true,
      },
      orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
      take: Math.min(Number(query.limit) || 50, 200),
    });
  }
  async getTrigger(id: string, identity: Identity) {
    const trigger = await this.db.sourceTrigger.findFirst({
      where: { id, organizationId: identity.organizationId },
      select: {
        id: true,
        sourceSystemId: true,
        connectorId: true,
        connectorType: true,
        triggerType: true,
        sourceRecordId: true,
        occurredAt: true,
        receivedAt: true,
        payloadSha256: true,
        metadataJson: true,
        extractedFieldsJson: true,
        caseId: true,
        status: true,
        correlationId: true,
        causationId: true,
        processingAttemptCount: true,
        lastErrorCode: true,
        createdAt: true,
      },
    });
    if (!trigger) throw new NotFoundException("Source trigger not found.");
    return trigger;
  }
  async getPayload(
    id: string,
    reason: string | undefined,
    identity: Identity,
    correlationId: string,
  ) {
    if (!identity.permissions.includes("integration:payload:read"))
      throw new ForbiddenException("Payload-read permission is required.");
    if (!reason || reason.trim().length < 3)
      throw new BadRequestException("A payload-access reason is required.");
    const trigger = await this.db.sourceTrigger.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!trigger) throw new NotFoundException("Source trigger not found.");
    await this.db.outboxEvent.create({
      data: {
        organizationId: identity.organizationId,
        topic: "cdep.integration.lifecycle.v1",
        messageKey: id,
        correlationId,
        eventJson: {
          eventId: randomUUID(),
          eventType: "integration.payload.accessed",
          eventVersion: "1.0",
          actorId: identity.userId,
          sourceTriggerId: id,
          reason,
        },
      },
    });
    return { id, payload: trigger.payloadJson };
  }
  listRuns(identity: Identity, query: any) {
    return this.db.ingestionRun.findMany({
      where: {
        organizationId: identity.organizationId,
        ...(query.connectorId ? { connectorId: query.connectorId } : {}),
      },
      orderBy: [{ startedAt: "desc" }, { id: "asc" }],
      take: 200,
    });
  }
  async getRun(id: string, identity: Identity) {
    const run = await this.db.ingestionRun.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!run) throw new NotFoundException("Run not found.");
    return run;
  }
  async replay(
    id: string,
    reason: string,
    key: string | undefined,
    identity: Identity,
  ) {
    const trigger = await this.db.sourceTrigger.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!trigger) throw new NotFoundException("Source trigger not found.");
    if (!reason?.trim())
      throw new BadRequestException("Replay reason is required.");
    const storedKey = key ? `replay:${id}:${key}` : undefined;
    if (storedKey) {
      const existing = await this.db.idempotencyRecord.findUnique({
        where: {
          organizationId_key: {
            organizationId: identity.organizationId,
            key: storedKey,
          },
        },
      });
      if (existing) return existing.responseJson;
    }
    const request = await this.db.replayRequest.create({
      data: {
        organizationId: identity.organizationId,
        sourceTriggerId: id,
        requestedBy: identity.userId,
        reason,
        status: "RUNNING",
      },
    });
    await this.db.failedTrigger.updateMany({
      where: { sourceTriggerId: id, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    await this.db.sourceTrigger.update({
      where: { id },
      data: { status: "RECEIVED", lastErrorCode: null },
    });
    await this.processTrigger(id);
    const finalTrigger = await this.db.sourceTrigger.findUniqueOrThrow({
      where: { id },
    });
    const replayStatus = ["FAILED", "EXTRACTION_FAILED"].includes(
      finalTrigger.status,
    )
      ? "FAILED"
      : "SUCCEEDED";
    const completed = await this.db.replayRequest.update({
      where: { id: request.id },
      data: { status: replayStatus },
    });
    if (storedKey)
      await this.db.idempotencyRecord.create({
        data: {
          organizationId: identity.organizationId,
          key: storedKey,
          responseJson: completed,
        },
      });
    return completed;
  }
  async resolveCase(
    id: string,
    body: any,
    bearer: string | undefined,
    identity: Identity,
  ) {
    const trigger = await this.db.sourceTrigger.findFirst({
      where: { id, organizationId: identity.organizationId },
    });
    if (!trigger) throw new NotFoundException("Source trigger not found.");
    if (!["UNMATCHED", "AMBIGUOUS_CORRELATION"].includes(trigger.status))
      throw new ConflictException(
        "Only unmatched or ambiguous triggers can be manually resolved.",
      );
    if (!body.caseId || !body.reason?.trim())
      throw new BadRequestException("caseId and reason are required.");
    const checked = await fetch(
      `${this.environment.CASE_SERVICE_URL}/api/v1/cases/${body.caseId}`,
      {
        headers: {
          authorization: bearer ?? "",
          "x-correlation-id": trigger.correlationId,
        },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!checked.ok)
      throw new BadRequestException(
        "Selected case was not found in this organization.",
      );
    const fields = (trigger.extractedFieldsJson ?? {}) as Record<string, any>;
    await this.db.journeyCorrelation.create({
      data: {
        organizationId: identity.organizationId,
        sourceTriggerId: id,
        caseId: body.caseId,
        outcome: "MATCHED",
        resolvedBy: identity.userId,
        resolutionReason: body.reason,
        previousState: trigger.status,
      },
    });
    await this.emitCanonical(
      trigger,
      fields,
      body.caseId,
      "MANUALLY_MATCHED",
      null,
    );
    return this.getTrigger(id, identity);
  }
  journey(caseId: string, identity: Identity) {
    return this.db.decisionJourneyEvent.findMany({
      where: { organizationId: identity.organizationId, caseId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
  }

  private validateWebhookConfiguration(input: any) {
    const rateLimitPerMinute = Number(input?.rateLimitPerMinute ?? 60);
    if (
      !Number.isInteger(rateLimitPerMinute) ||
      rateLimitPerMinute < 1 ||
      rateLimitPerMinute > 10_000
    )
      throw new BadRequestException("Invalid webhook rate limit.");
    return { rateLimitPerMinute };
  }
  private sanitizeConnector(connector: ConnectorDefinition) {
    const { credentialId, ...configuration } = connector;
    return {
      ...configuration,
      credential: { configured: Boolean(credentialId) },
    };
  }
  private parseSqlCredential(value: string): ResolvedCredential {
    try {
      const parsed = JSON.parse(value);
      if (
        typeof parsed.username !== "string" ||
        typeof parsed.password !== "string" ||
        !parsed.username ||
        !parsed.password
      )
        throw new Error();
      return { username: parsed.username, password: parsed.password };
    } catch {
      throw new BadRequestException(
        "SQL credentials must contain username and password.",
      );
    }
  }
  private async resolveCredential(connector: ConnectorDefinition) {
    if (!connector.credentialId)
      throw new UnprocessableEntityException("Credential is not configured.");
    const credential = await this.db.connectorCredential.findFirst({
      where: {
        id: connector.credentialId,
        organizationId: connector.organizationId,
      },
    });
    if (!credential)
      throw new UnprocessableEntityException("Credential is not configured.");
    return this.secrets.decrypt(credential);
  }
  private async resolveSqlCredential(connector: ConnectorDefinition) {
    return this.parseSqlCredential(await this.resolveCredential(connector));
  }
  private extract(
    payload: unknown,
    rules: Array<{
      targetField: string;
      sourcePath: string;
      required: boolean;
      defaultValue: string | null;
      transform: string | null;
    }>,
  ) {
    const fields: Record<string, any> = {},
      errors: string[] = [];
    for (const rule of rules) {
      try {
        let value = JSONPath({
          path: rule.sourcePath,
          json: payload as any,
          wrap: false,
        });
        if (value == null) value = rule.defaultValue;
        if (value == null && rule.required) {
          errors.push(`REQUIRED_FIELD_MISSING:${rule.targetField}`);
          continue;
        }
        if (value != null && rule.transform)
          value = this.applyExtractionTransform(value, rule.transform);
        if (value != null) fields[rule.targetField] = value;
      } catch {
        errors.push(`EXTRACTION_INVALID:${rule.targetField}`);
      }
    }
    return { valid: errors.length === 0, fields, errors };
  }
  private applyExtractionTransform(value: any, transform: string) {
    switch (transform) {
      case "TRIM":
        return String(value).trim();
      case "LOWERCASE":
        return String(value).toLowerCase();
      case "UPPERCASE":
        return String(value).toUpperCase();
      case "STRING":
        return String(value);
      case "ISO_DATETIME": {
        const date = new Date(value);
        if (Number.isNaN(date.valueOf())) throw new Error();
        return date.toISOString();
      }
      default:
        throw new Error();
    }
  }
  private async acquireLease(connector: ConnectorDefinition) {
    const ownerId = randomUUID();
    const expiresAt = new Date(
      Date.now() + this.environment.SQL_POLL_LEASE_SECONDS * 1000,
    );
    const acquired = await this.db
      .$executeRaw`INSERT INTO connector_leases (connector_id, organization_id, owner_id, expires_at)
      VALUES (${connector.id}::uuid, ${connector.organizationId}::uuid, ${ownerId}::uuid, ${expiresAt})
      ON CONFLICT (connector_id) DO UPDATE SET owner_id=EXCLUDED.owner_id, expires_at=EXCLUDED.expires_at
      WHERE connector_leases.expires_at < NOW()`;
    if (!acquired) throw new ConflictException("CONNECTOR_LEASE_HELD");
    return ownerId;
  }
  private releaseLease(connectorId: string, ownerId: string) {
    return this.db.connectorLease.deleteMany({
      where: { connectorId, ownerId },
    });
  }
  private async recordPollFailure(
    connector: ConnectorDefinition,
    runId: string,
    leaseOwnerId: string,
  ) {
    await this.db.$transaction(async (tx) => {
      const updated = await tx.connectorDefinition.update({
        where: { id: connector.id },
        data: {
          consecutiveFailureCount: { increment: 1 },
          lastErrorCode: "SQL_POLL_FAILED",
          nextRunAt: new Date(
            Date.now() + (connector.pollIntervalSeconds ?? 60) * 1000,
          ),
        },
      });
      if (
        updated.consecutiveFailureCount >=
        this.environment.SQL_POLL_FAILURE_PAUSE_THRESHOLD
      )
        await tx.connectorDefinition.update({
          where: { id: connector.id },
          data: { status: "PAUSED" },
        });
      await tx.ingestionRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          errorCode: "SQL_POLL_FAILED",
          completedAt: new Date(),
        },
      });
      await tx.connectorLease.deleteMany({
        where: { connectorId: connector.id, ownerId: leaseOwnerId },
      });
    });
  }
  private async markCorrelation(
    trigger: SourceTrigger,
    outcome: "UNMATCHED" | "AMBIGUOUS_CORRELATION",
    ruleId: string,
    fields: Record<string, any>,
    caseId: string | null,
  ) {
    await this.db.$transaction(async (tx) => {
      await tx.sourceTrigger.update({
        where: { id: trigger.id },
        data: { status: outcome, extractedFieldsJson: fields, caseId },
      });
      await tx.journeyCorrelation.create({
        data: {
          organizationId: trigger.organizationId,
          sourceTriggerId: trigger.id,
          caseId,
          outcome,
          ruleVersionId: ruleId,
        },
      });
      await tx.decisionJourneyEvent.create({
        data: {
          organizationId: trigger.organizationId,
          caseId,
          sourceTriggerId: trigger.id,
          eventType: trigger.triggerType,
          sourceSystemId: trigger.sourceSystemId,
          sourceRecordId: trigger.sourceRecordId,
          occurredAt: trigger.occurredAt ?? trigger.receivedAt,
          receivedAt: trigger.receivedAt,
          processingStatus: outcome,
          correlationOutcome: outcome,
          correlationId: trigger.correlationId,
          causationId: trigger.causationId,
          summaryJson: this.summary(fields),
        },
      });
    });
  }
  private async emitCanonical(
    trigger: SourceTrigger,
    fields: Record<string, any>,
    caseId: string | null,
    correlationOutcome: string,
    ruleId: string | null,
  ) {
    const eventId = randomUUID(),
      occurredAt = trigger.occurredAt ?? trigger.receivedAt;
    const evidenceReference =
      trigger.triggerType === "evidence.reference.received"
        ? evidenceReferenceProjectionSchema.safeParse({
            classificationCode: fields.classificationCode,
            title: fields.title,
            externalReference: fields.externalReference,
            ...(typeof fields.description === "string"
              ? { description: fields.description }
              : {}),
          })
        : null;
    const event = {
      eventId,
      eventType: "source.trigger.received",
      eventVersion: "1.0",
      occurredAt: occurredAt.toISOString(),
      organizationId: trigger.organizationId,
      source: {
        systemId: trigger.sourceSystemId,
        connectorId: trigger.connectorId,
        connectorType: trigger.connectorType,
        triggerType: trigger.triggerType,
        ...(trigger.sourceRecordId
          ? { sourceRecordId: trigger.sourceRecordId }
          : {}),
      },
      journey: {
        ...(caseId ? { caseId } : {}),
        ...(fields.businessReference
          ? { businessReference: fields.businessReference }
          : {}),
        correlationId: trigger.correlationId,
        ...(trigger.causationId ? { causationId: trigger.causationId } : {}),
      },
      subject: {
        ...(fields.subjectType ? { type: fields.subjectType } : {}),
        ...(fields.subjectId ? { id: fields.subjectId } : {}),
      },
      data: {
        extractedFields: fields,
        ...(evidenceReference?.success
          ? { evidenceReference: evidenceReference.data }
          : {}),
      },
      rawPayloadReference: trigger.id,
    };
    canonicalTriggerEventSchema.parse(event);
    await this.db.$transaction(async (tx) => {
      const canonical = await tx.canonicalTriggerEvent.upsert({
        where: { sourceTriggerId: trigger.id },
        update: { caseId, eventJson: event, status: "PENDING" },
        create: {
          id: eventId,
          organizationId: trigger.organizationId,
          sourceTriggerId: trigger.id,
          caseId,
          eventJson: event,
          status: "PENDING",
          correlationId: trigger.correlationId,
        },
      });
      await tx.outboxEvent.upsert({
        where: { id: canonical.id },
        update: {
          messageKey: caseId ?? trigger.id,
          eventJson: event,
          correlationId: trigger.correlationId,
          publishedAt: null,
          attempts: 0,
        },
        create: {
          id: canonical.id,
          organizationId: trigger.organizationId,
          topic: "cdep.integration.trigger.v1",
          messageKey: caseId ?? trigger.id,
          eventJson: event,
          correlationId: trigger.correlationId,
        },
      });
      await tx.sourceTrigger.update({
        where: { id: trigger.id },
        data: { status: "READY", caseId, extractedFieldsJson: fields },
      });
      await tx.journeyCorrelation.create({
        data: {
          organizationId: trigger.organizationId,
          sourceTriggerId: trigger.id,
          caseId,
          outcome: correlationOutcome,
          ruleVersionId: ruleId,
        },
      });
      await tx.decisionJourneyEvent.create({
        data: {
          organizationId: trigger.organizationId,
          caseId,
          sourceTriggerId: trigger.id,
          canonicalEventId: canonical.id,
          eventType: trigger.triggerType,
          sourceSystemId: trigger.sourceSystemId,
          sourceRecordId: trigger.sourceRecordId,
          occurredAt,
          receivedAt: trigger.receivedAt,
          processingStatus: "READY",
          correlationOutcome,
          correlationId: trigger.correlationId,
          causationId: trigger.causationId,
          summaryJson: this.summary(fields),
        },
      });
      await tx.processingAttempt.create({
        data: {
          organizationId: trigger.organizationId,
          sourceTriggerId: trigger.id,
          stage: "CANONICALIZE",
          outcome: "SUCCEEDED",
        },
      });
    });
  }
  private async failTrigger(
    trigger: SourceTrigger,
    code: string,
    detail: string,
  ) {
    await this.db.$transaction(async (tx) => {
      await tx.sourceTrigger.update({
        where: { id: trigger.id },
        data: {
          status: code === "EXTRACTION_FAILED" ? "EXTRACTION_FAILED" : "FAILED",
          lastErrorCode: code,
          processingAttemptCount: { increment: 1 },
        },
      });
      await tx.failedTrigger.create({
        data: {
          organizationId: trigger.organizationId,
          sourceTriggerId: trigger.id,
          errorCode: code,
          sanitizedDetail: detail.slice(0, 1000),
        },
      });
      await tx.processingAttempt.create({
        data: {
          organizationId: trigger.organizationId,
          sourceTriggerId: trigger.id,
          stage: "PROCESS",
          outcome: "FAILED",
          errorCode: code,
        },
      });
    });
  }
  private summary(fields: Record<string, any>) {
    return Object.fromEntries(
      ["businessReference", "subjectType", "subjectId"]
        .filter((key) => fields[key] != null)
        .map((key) => [key, fields[key]]),
    );
  }
  private receipt(trigger: SourceTrigger) {
    return {
      receiptId: trigger.id,
      status: "RECEIVED",
      correlationId: trigger.correlationId,
      receivedAt: trigger.receivedAt.toISOString(),
    };
  }
  private lifecycle(
    tx: any,
    organizationId: string,
    key: string,
    correlationId: string,
    eventType: string,
    data: object,
  ) {
    return tx.outboxEvent.create({
      data: {
        organizationId,
        topic: "cdep.integration.lifecycle.v1",
        messageKey: key,
        correlationId,
        eventJson: {
          eventId: randomUUID(),
          eventType,
          eventVersion: "1.0",
          occurredAt: new Date().toISOString(),
          data,
        },
      },
    });
  }
}
