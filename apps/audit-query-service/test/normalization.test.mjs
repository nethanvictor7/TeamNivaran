import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDomainEvent } from "../dist/src/normalize-event.js";

const ids = {
  event: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  correlation: "10000000-0000-4000-8000-000000000003",
  aggregate: "10000000-0000-4000-8000-000000000004",
};

test("normalizes the established AI event envelope without inventing tenant context", () => {
  const result = normalizeDomainEvent(
    {
      eventId: ids.event,
      eventType: "ai.assessment.requested",
      eventVersion: "1.0",
      occurredAt: "2026-07-28T00:00:00.000Z",
      organizationId: ids.organization,
      correlationId: ids.correlation,
      aggregate: {
        type: "Assessment",
        id: ids.aggregate,
        version: 1,
      },
      data: { caseId: ids.aggregate, status: "QUEUED" },
    },
    "cdep.ai.assessment.v1",
  );
  assert.equal(result.accepted, true);
  assert.equal(result.event.producer, "ai-assessment-service");
  assert.deepEqual(result.event.actor, {
    type: "SYSTEM",
    id: "ai-assessment-service",
  });
  assert.equal(result.event.payload.caseId, ids.aggregate);
});

test("normalizes source-aware triggers only when trusted tenant context exists", () => {
  const base = {
    eventId: ids.event,
    eventType: "source.trigger.received",
    eventVersion: "1.0",
    occurredAt: "2026-07-28T00:00:00.000Z",
    organizationId: ids.organization,
    rawPayloadReference: ids.aggregate,
    journey: { correlationId: ids.correlation, caseId: ids.aggregate },
    source: { connectorType: "WEBHOOK" },
    subject: {},
    data: { extractedFields: {} },
  };
  const accepted = normalizeDomainEvent(base, "cdep.integration.trigger.v1");
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.event.aggregate.type, "SourceTrigger");
  assert.equal(accepted.event.payload.caseId, ids.aggregate);
  assert.deepEqual(
    normalizeDomainEvent(
      { ...base, organizationId: undefined },
      "cdep.integration.trigger.v1",
    ),
    { accepted: false, code: "TENANT_CONTEXT_MISSING" },
  );
});

test("rejects incompatible schema versions through the normalization boundary", () => {
  const result = normalizeDomainEvent(
    {
      eventId: ids.event,
      eventType: "ai.assessment.requested",
      eventVersion: "2.0",
      occurredAt: "2026-07-28T00:00:00.000Z",
      organizationId: ids.organization,
      correlationId: ids.correlation,
      aggregate: {
        type: "Assessment",
        id: ids.aggregate,
        version: 1,
      },
      data: {},
    },
    "cdep.ai.assessment.v1",
  );
  assert.deepEqual(result, {
    accepted: false,
    code: "UNSUPPORTED_EVENT_VERSION",
  });
});
