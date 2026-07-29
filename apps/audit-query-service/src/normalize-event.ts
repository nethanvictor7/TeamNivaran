import { eventEnvelopeSchema, type EventEnvelope } from "@cdep/contracts";
import { z } from "zod";

const leanEventSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  eventVersion: z.string().regex(/^\d+\.\d+$/),
  occurredAt: z.iso.datetime(),
  organizationId: z.uuid().nullish(),
  correlationId: z.uuid().optional(),
  causationId: z.uuid().nullish(),
  producer: z.string().min(1).optional(),
  actor: z
    .object({
      type: z.enum(["USER", "SERVICE", "SYSTEM"]),
      id: z.string().min(1),
    })
    .optional(),
  aggregate: z
    .object({
      type: z.string().min(1),
      id: z.string().min(1),
      version: z.number().int().nonnegative(),
    })
    .optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  rawPayloadReference: z.uuid().optional(),
  journey: z
    .object({
      correlationId: z.uuid(),
      caseId: z.uuid().optional(),
    })
    .passthrough()
    .optional(),
  source: z.record(z.string(), z.unknown()).optional(),
  subject: z.record(z.string(), z.unknown()).optional(),
});

const topicProducer: Record<string, string> = {
  "cdep.case.v1": "case-service",
  "cdep.integration.lifecycle.v1": "integration-ingestion-service",
  "cdep.integration.trigger.v1": "integration-ingestion-service",
  "cdep.evidence.events.v1": "evidence-service",
  "cdep.workflow.events.v1": "validation-workflow-service",
  "cdep.ai.assessment.v1": "ai-assessment-service",
  "cdep.ai.governance.v1": "ai-assessment-service",
  "cdep.ledger.proof.v1": "ledger-service",
  "cdep.ledger.verification.v1": "ledger-service",
  "cdep.ledger.dlt.v1": "ledger-service",
  "cdep.audit.events.v1": "audit-query-service",
};

export type NormalizationResult =
  | { accepted: true; event: EventEnvelope }
  | {
      accepted: false;
      code:
        | "SCHEMA_INVALID"
        | "TENANT_CONTEXT_MISSING"
        | "UNSUPPORTED_EVENT_VERSION";
    };

export function normalizeDomainEvent(
  value: unknown,
  topic: string,
): NormalizationResult {
  const canonical = eventEnvelopeSchema.safeParse(value);
  if (canonical.success) {
    if (!canonical.data.organizationId)
      return { accepted: false, code: "TENANT_CONTEXT_MISSING" };
    return { accepted: true, event: canonical.data };
  }
  const parsed = leanEventSchema.safeParse(value);
  if (!parsed.success) return { accepted: false, code: "SCHEMA_INVALID" };
  const input = parsed.data;
  if (input.eventVersion !== "1.0")
    return { accepted: false, code: "UNSUPPORTED_EVENT_VERSION" };
  if (!input.organizationId)
    return { accepted: false, code: "TENANT_CONTEXT_MISSING" };
  const producer = input.producer ?? topicProducer[topic];
  if (!producer) return { accepted: false, code: "SCHEMA_INVALID" };
  const correlationId = input.correlationId ?? input.journey?.correlationId;
  if (!correlationId) return { accepted: false, code: "SCHEMA_INVALID" };
  const aggregate =
    input.aggregate ??
    (input.rawPayloadReference
      ? {
          type: "SourceTrigger",
          id: input.rawPayloadReference,
          version: 1,
        }
      : undefined);
  if (!aggregate) return { accepted: false, code: "SCHEMA_INVALID" };
  const payload = {
    ...(input.payload ?? input.data ?? {}),
    ...(input.journey?.caseId ? { caseId: input.journey.caseId } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.rawPayloadReference
      ? { rawPayloadReference: input.rawPayloadReference }
      : {}),
  };
  return {
    accepted: true,
    event: {
      eventId: input.eventId,
      eventType: input.eventType,
      eventVersion: input.eventVersion,
      occurredAt: input.occurredAt,
      correlationId,
      causationId: input.causationId ?? null,
      producer,
      organizationId: input.organizationId,
      actor: input.actor ?? { type: "SYSTEM", id: producer },
      aggregate,
      payload,
    },
  };
}
