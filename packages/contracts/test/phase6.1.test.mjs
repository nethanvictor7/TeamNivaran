import assert from "node:assert/strict";
import test from "node:test";
import {
  caseLedgerSummarySchema,
  caseProofListQuerySchema,
  ledgerTransactionSchema,
} from "../dist/index.js";

test("Phase 6.1 proof-list filters reject unknown and unsafe values", () => {
  assert.equal(
    caseProofListQuerySchema.safeParse({ pageSize: "25" }).success,
    true,
  );
  assert.equal(
    caseProofListQuerySchema.safeParse({ pageSize: "51" }).success,
    false,
  );
  assert.equal(
    caseProofListQuerySchema.safeParse({ unknown: "value" }).success,
    false,
  );
});

test("Phase 6.1 transaction details remain provider neutral", () => {
  const parsed = ledgerTransactionSchema.parse({
    proofRequestId: "11111111-1111-4111-8111-111111111111",
    providerType: "FABRIC",
    state: "FINALIZED",
    providerTransactionId: "opaque-provider-transaction",
  });
  assert.equal(parsed.state, "FINALIZED");
  assert.equal("peer" in parsed, false);
  assert.equal("mspId" in parsed, false);
});

test("Phase 6.1 summary requires explicit freshness and ledger availability", () => {
  const parsed = caseLedgerSummarySchema.safeParse({
    caseId: "11111111-1111-4111-8111-111111111111",
    state: "NOT_ELIGIBLE",
    ledgerAvailability: {
      available: true,
      providerType: "FABRIC",
      status: "AVAILABLE",
      checkedAt: "2026-07-27T00:00:00.000Z",
      safeErrorCode: null,
    },
    decision: {
      eligibility: "NOT_ELIGIBLE",
      reasonCode: "TERMINAL_DECISION_REQUIRED",
      explanation: "Terminal decision required.",
      decisionId: null,
      decisionOutcome: null,
      lifecycle: null,
      proofRequestId: null,
    },
    evidenceCounts: {
      eligible: 0,
      pending: 0,
      submitted: 0,
      confirmed: 0,
      failed: 0,
      notAnchored: 0,
    },
    evidenceTargets: [],
    latestVerification: null,
    latestConfirmed: null,
    freshness: {
      generatedAt: "2026-07-27T00:00:00.000Z",
      evidenceSnapshotAt: "2026-07-27T00:00:00.000Z",
      staleAfter: "2026-07-27T00:00:30.000Z",
    },
  });
  assert.equal(parsed.success, true);
});
