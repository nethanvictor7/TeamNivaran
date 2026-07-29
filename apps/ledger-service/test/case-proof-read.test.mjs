import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { CaseProofReadService } from "../dist/src/case-proof-read.service.js";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost/test",
  CASE_SERVICE_URL: "http://localhost:3002",
  EVIDENCE_SERVICE_URL: "http://localhost:3004",
  WORKFLOW_SERVICE_URL: "http://localhost:3005",
  JWT_JWKS_URL: "http://localhost:3001/api/v1/auth/jwks",
  INTERNAL_SERVICE_TOKEN: "a".repeat(32),
  KAFKA_BROKERS: "localhost:9092",
  LEDGER_PROVIDER: "FABRIC",
});

const organizationId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const proofRow = {
  id: "44444444-4444-4444-8444-444444444444",
  proofId: "55555555-5555-4555-8555-555555555555",
  organizationId,
  caseId,
  kind: "EVIDENCE",
  evidenceAssetId: "66666666-6666-4666-8666-666666666666",
  evidenceVersionId: "77777777-7777-4777-8777-777777777777",
  decisionId: null,
  canonicalPayload: {},
  canonicalSha256: "a".repeat(64),
  providerType: "FABRIC",
  state: "CONFIRMED",
  attempts: 1,
  nextAttemptAt: null,
  leaseOwner: null,
  leaseExpiresAt: null,
  safeErrorCode: null,
  requestedBy: actorId,
  requestedAt: new Date("2026-07-27T00:00:00.000Z"),
  submittedAt: new Date("2026-07-27T00:00:01.000Z"),
  confirmedAt: new Date("2026-07-27T00:00:02.000Z"),
  rowVersion: 2,
  correlationId: "88888888-8888-4888-8888-888888888888",
  binding: {
    providerType: "FABRIC",
    providerTransactionId: "fabric-tx",
    providerProofReference: "provider-proof",
    providerContractReference: "cdep-proof-registry",
    providerNetworkReference: "cdep-proof-channel",
  },
  evidenceRecord: { previousProofId: null },
  decisionRecord: null,
  transactions: [],
  verifications: [],
};

function fixture(rows = []) {
  const calls = [];
  const dependencies = {
    async caseSnapshot(org, requestedCase) {
      calls.push({ org, requestedCase });
      if (org !== organizationId || requestedCase !== caseId)
        throw new NotFoundException();
      return { id: caseId };
    },
    async caseEvidenceSnapshot() {
      return {
        organizationId,
        caseId,
        snapshotAt: "2026-07-27T00:00:00.000Z",
        items: [
          {
            evidenceAssetId: proofRow.evidenceAssetId,
            evidenceVersionId: proofRow.evidenceVersionId,
            classificationCode: "INCOME",
          },
        ],
      };
    },
    async decisionSnapshot() {
      throw new NotFoundException();
    },
  };
  const prisma = {
    proofRequest: {
      async findMany(args) {
        calls.push(args);
        return rows;
      },
    },
    outboxEvent: {
      async findMany() {
        return [];
      },
    },
  };
  const providers = {
    active: {
      async getHealth() {
        return { state: "AVAILABLE", providerType: "FABRIC" };
      },
    },
  };
  return {
    calls,
    service: new CaseProofReadService(prisma, dependencies, providers),
  };
}

test("summary joins current evidence to canonical proof state", async () => {
  const { service } = fixture([proofRow]);
  const result = await service.summary(
    caseId,
    {
      organizationId,
      userId: actorId,
      permissions: ["proof:read"],
    },
    "88888888-8888-4888-8888-888888888888",
  );
  assert.equal(result.state, "ANCHORED");
  assert.equal(result.evidenceCounts.confirmed, 1);
  assert.equal(result.evidenceTargets[0].proofRequestId, proofRow.id);
});

test("proof list enforces tenant scope and produces tamper-evident cursors", async () => {
  const { service, calls } = fixture([proofRow, { ...proofRow, id: actorId }]);
  const identity = {
    organizationId,
    userId: actorId,
    permissions: ["proof:read"],
  };
  const page = await service.list(
    caseId,
    identity,
    "88888888-8888-4888-8888-888888888888",
    { pageSize: "1", proofType: "EVIDENCE" },
  );
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  const query = calls.find((call) => call?.where);
  assert.equal(query.where.organizationId, organizationId);
  assert.equal(query.where.caseId, caseId);
  await assert.rejects(
    service.list(caseId, identity, "88888888-8888-4888-8888-888888888888", {
      pageSize: "1",
      proofType: "EVIDENCE",
      cursor: `${page.nextCursor}tampered`,
    }),
    /cursor is invalid/,
  );
});

test("cross-organization case reads fail before proof storage is queried", async () => {
  const { service, calls } = fixture([proofRow]);
  await assert.rejects(
    service.list(
      caseId,
      {
        organizationId: "99999999-9999-4999-8999-999999999999",
        userId: actorId,
        permissions: ["proof:read"],
      },
      "88888888-8888-4888-8888-888888888888",
      {},
    ),
    NotFoundException,
  );
  assert.equal(
    calls.some((call) => call?.where),
    false,
  );
});
