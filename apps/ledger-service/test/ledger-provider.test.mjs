import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256, canonicalize } from "../dist/src/canonicalization.js";
import {
  LedgerProviderError,
  MockLedgerProvider,
} from "../dist/src/ledger-provider.js";
import { ledgerTopicFor } from "../dist/src/outbox.publisher.js";

const evidence = {
  kind: "EVIDENCE",
  schemaVersion: "1.0",
  proofId: "60000000-0000-4000-8000-000000000010",
  organizationScopeHash:
    "a6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
  caseReferenceHash:
    "b6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
  evidenceId: "60000000-0000-4000-8000-000000000011",
  evidenceVersionId: "60000000-0000-4000-8000-000000000012",
  contentSha256:
    "c6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
  metadataSha256:
    "d6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
  previousProofId: null,
};

test("canonicalization matches the cross-language Phase 6 vector", () => {
  const value = {
    z: "last",
    a: [2, "x"],
    nested: { b: true, a: null },
  };
  assert.equal(
    canonicalize(value),
    '{"a":[2,"x"],"nested":{"a":null,"b":true},"z":"last"}',
  );
  assert.equal(
    canonicalSha256(value),
    "f00fd09a06465684b90b07fe3dba58e7a0faab663d087ea7d6362b80acb5e645",
  );
});

test("provider contract is idempotent and immutable by proof ID", async () => {
  const provider = new MockLedgerProvider();
  const request = {
    envelope: evidence,
    canonicalBytes: canonicalize(evidence),
    idempotencyKey: "test-key",
  };
  const first = await provider.submitProof(request);
  const duplicate = await provider.submitProof(request);
  assert.deepEqual(duplicate, first);
  assert.equal((await provider.queryProof(evidence.proofId)).kind, "EVIDENCE");

  await assert.rejects(
    provider.submitProof({
      ...request,
      envelope: {
        ...evidence,
        contentSha256:
          "e6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
      },
    }),
    (error) =>
      error instanceof LedgerProviderError &&
      error.code === "PROOF_ID_CONFLICT" &&
      error.conflict,
  );
});

test("provider verification distinguishes matches from mismatches", async () => {
  const provider = new MockLedgerProvider();
  await provider.submitProof({
    envelope: evidence,
    canonicalBytes: canonicalize(evidence),
    idempotencyKey: "verify",
  });
  const valid = await provider.verifyProof({
    proofId: evidence.proofId,
    expectedHashes: [evidence.contentSha256, evidence.metadataSha256],
  });
  assert.equal(valid.proofConfirmed, true);
  assert.equal(valid.hashMatch, true);
  const invalid = await provider.verifyProof({
    proofId: evidence.proofId,
    expectedHashes: ["0".repeat(64)],
  });
  assert.equal(invalid.hashMatch, false);
});

test("provider-neutral events use the three versioned ledger topics", () => {
  assert.equal(ledgerTopicFor("proof.requested"), "cdep.ledger.proof.v1");
  assert.equal(ledgerTopicFor("proof.submitted"), "cdep.ledger.dlt.v1");
  assert.equal(ledgerTopicFor("proof.confirmed"), "cdep.ledger.dlt.v1");
  assert.equal(
    ledgerTopicFor("decision-proof.confirmed"),
    "cdep.ledger.dlt.v1",
  );
  assert.equal(
    ledgerTopicFor("proof.verification.completed"),
    "cdep.ledger.verification.v1",
  );
});
