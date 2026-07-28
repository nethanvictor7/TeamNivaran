import assert from "node:assert/strict";
import test from "node:test";
import {
  accessTokenClaimsSchema,
  canonicalTriggerEventSchema,
  eventEnvelopeSchema,
  loginRequestSchema,
} from "../dist/index.js";

test("accepts the versioned CDEP event envelope", () => {
  const parsed = eventEnvelopeSchema.parse({
    eventId: "138f7bce-1f13-4ed2-8eac-ae5e47e55aba",
    eventType: "identity.user.created",
    eventVersion: "1.0",
    occurredAt: "2026-07-23T16:00:00.000Z",
    correlationId: "5ac31606-d3d5-4395-88eb-5d89d458dd41",
    causationId: null,
    producer: "identity-access-service",
    organizationId: "b7040c5f-cfec-4d44-b805-5d1eef69f649",
    actor: { type: "SERVICE", id: "identity-access-service" },
    aggregate: { type: "User", id: "user-1", version: 1 },
    payload: { status: "ACTIVE" },
  });
  assert.equal(parsed.eventVersion, "1.0");
});

test("rejects short passwords at the API boundary", () => {
  const parsed = loginRequestSchema.safeParse({
    email: "analyst@cdep.local",
    password: "short",
  });
  assert.equal(parsed.success, false);
});

test("requires access-token type and UUID claims", () => {
  const parsed = accessTokenClaimsSchema.safeParse({
    sub: "5ac31606-d3d5-4395-88eb-5d89d458dd41",
    org_id: "b7040c5f-cfec-4d44-b805-5d1eef69f649",
    roles: ["reviewer"],
    permissions: ["case:read"],
    session_id: "138f7bce-1f13-4ed2-8eac-ae5e47e55aba",
    token_type: "refresh",
    iss: "cdep-identity-access-service",
    aud: "cdep-api",
    jti: "f012c4e7-810d-45a9-b7ed-ddd442d8cc9c",
    iat: 1,
    exp: 2,
  });
  assert.equal(parsed.success, false);
});

test("canonical trigger supports a typed evidence reference without binary content", () => {
  const event = canonicalTriggerEventSchema.parse({
    eventId: "138f7bce-1f13-4ed2-8eac-ae5e47e55aba",
    eventType: "source.trigger.received",
    eventVersion: "1.0",
    occurredAt: "2026-07-27T10:00:00.000Z",
    organizationId: "b7040c5f-cfec-4d44-b805-5d1eef69f649",
    source: {
      systemId: "5ac31606-d3d5-4395-88eb-5d89d458dd41",
      connectorId: "f012c4e7-810d-45a9-b7ed-ddd442d8cc9c",
      connectorType: "WEBHOOK",
      triggerType: "evidence.reference.received",
    },
    journey: {
      caseId: "74b6b51a-46bb-4f05-a38b-8f6fd28ed275",
      correlationId: "926f96d3-0324-47af-9bcf-f8f0f4dd211f",
    },
    subject: {},
    data: {
      extractedFields: {
        classificationCode: "BANK_STATEMENT",
        title: "Current account statement",
        externalReference: "DOC-42",
      },
      evidenceReference: {
        classificationCode: "BANK_STATEMENT",
        title: "Current account statement",
        externalReference: "DOC-42",
      },
    },
    rawPayloadReference: "7fd6f704-f954-4c51-99f2-e6b55dbd2e51",
  });
  assert.equal(
    event.data.evidenceReference.classificationCode,
    "BANK_STATEMENT",
  );
  assert.equal("content" in event.data.evidenceReference, false);
});
