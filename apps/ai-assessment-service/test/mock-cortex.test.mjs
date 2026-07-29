import assert from "node:assert/strict";
import test from "node:test";
import {
  CortexGatewayError,
  MockCortexGateway,
} from "../dist/src/cortex-gateway.js";

const input = (profile) => ({
  assessmentId: "10000000-0000-4000-8000-000000000001",
  inputFingerprint: "a".repeat(64),
  profile,
  evidenceRefs: [
    {
      evidenceAssetId: "10000000-0000-4000-8000-000000000002",
      evidenceVersionId: "10000000-0000-4000-8000-000000000003",
    },
  ],
});

test("SUCCESS is deterministic and cites the pinned version", async () => {
  const gateway = new MockCortexGateway();
  const first = await gateway.submit(input("SUCCESS"));
  const second = await gateway.submit(input("SUCCESS"));
  assert.equal(first.providerExecutionId, second.providerExecutionId);
  const result = await gateway.result(first, input("SUCCESS"));
  assert.equal(
    result.rawOutput.citations[0].evidenceVersionId,
    input("SUCCESS").evidenceRefs[0].evidenceVersionId,
  );
});

test("mock profile is selected outside the assessment request", async () => {
  const gateway = new MockCortexGateway();
  const submission = await gateway.submit(input("MISSING_INFORMATION"));
  const result = await gateway.result(submission, input("MISSING_INFORMATION"));
  assert.equal(result.rawOutput.recommendation, "MORE_INFORMATION_REQUIRED");
});

test("POLICY_BLOCK fails closed without provider I/O", async () => {
  const gateway = new MockCortexGateway();
  await assert.rejects(
    gateway.submit(input("POLICY_BLOCK")),
    (error) =>
      error instanceof CortexGatewayError &&
      error.code === "MOCK_POLICY_BLOCK" &&
      error.retryable === false,
  );
});

test("TRANSIENT_FAILURE is explicitly retryable", async () => {
  const gateway = new MockCortexGateway();
  await assert.rejects(
    gateway.submit(input("TRANSIENT_FAILURE")),
    (error) =>
      error instanceof CortexGatewayError &&
      error.code === "MOCK_TRANSIENT_FAILURE" &&
      error.retryable,
  );
});

test("every deterministic result profile stays inside the typed mock boundary", async () => {
  const gateway = new MockCortexGateway();
  for (const profile of [
    "RISK_INDICATORS",
    "INVALID_JSON",
    "INVALID_SCHEMA",
    "BAD_CITATION",
  ]) {
    const submission = await gateway.submit(input(profile));
    const result = await gateway.result(submission, input(profile));
    assert.equal(result.providerExecutionId, submission.providerExecutionId);
  }
});

test("timeout and delayed work honor cancellation", async () => {
  const gateway = new MockCortexGateway();
  for (const profile of ["TIMEOUT", "DELAYED_RESULT"]) {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      gateway.submit(input(profile), controller.signal),
      (error) =>
        error instanceof CortexGatewayError &&
        error.code === "MOCK_ABORTED" &&
        error.retryable === false,
    );
  }
});

test("self-test is synthetic and performs zero outbound network calls", async () => {
  const gateway = new MockCortexGateway();
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = async () => {
    outboundCalls += 1;
    throw new Error("Outbound network use is forbidden in Mock Cortex.");
  };
  try {
    const result = await gateway.testConnection({
      correlationId: "10000000-0000-4000-8000-000000000004",
    });
    assert.equal(result.adapterMode, "MOCK");
    assert.equal(result.executionMode, "MOCK_SYNCHRONOUS");
    assert.equal(result.isSynthetic, true);
    assert.equal(result.providerLabel, "CDEP_DETERMINISTIC_MOCK_V1");
    assert.equal(outboundCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
