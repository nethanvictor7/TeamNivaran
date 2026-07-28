import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const base = process.env.CDEP_BASE_URL ?? "http://api-gateway:3000";
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@cdep.local";
const auditorEmail =
  process.env.BOOTSTRAP_AUDITOR_EMAIL ?? "auditor@cdep.local";
const outsiderEmail =
  process.env.BOOTSTRAP_OUTSIDER_EMAIL ?? "outsider@cdep.local";
assert(password, "Phase 6.1 validator requires BOOTSTRAP_ADMIN_PASSWORD.");

let assertions = 0;
function check(condition, message) {
  assert(condition, message);
  assertions += 1;
}

async function request(
  path,
  { expected = [200], token, json, headers = {}, ...init } = {},
) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    body: json === undefined ? undefined : JSON.stringify(json),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  assert(
    expected.includes(response.status),
    `${init.method ?? "GET"} ${path}: expected ${expected.join("/")} but got ${response.status}: ${JSON.stringify(body)}`,
  );
  check(
    Boolean(response.headers.get("x-correlation-id")),
    `${path} did not preserve a correlation identifier.`,
  );
  return body;
}

async function login(email) {
  const result = await request("/api/v1/auth/login", {
    method: "POST",
    json: { email, password },
  });
  check(Boolean(result.accessToken), `Login failed for ${email}.`);
  return result.accessToken;
}

async function runPhase6FabricValidator() {
  const script = fileURLToPath(
    new URL("./validate-phase6.mjs", import.meta.url),
  );
  const child = spawn(process.execPath, [script], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(
    code,
    0,
    `Phase 6 Fabric prerequisite validator failed:\n${stdout}\n${stderr}`,
  );
  const resultLine = stdout
    .trim()
    .split("\n")
    .reverse()
    .find((line) => line.startsWith("{"));
  assert(resultLine, "Phase 6 validator did not return its verified IDs.");
  const result = JSON.parse(resultLine);
  check(
    result.result === "PASS Phase 6 Fabric Docker end-to-end validation",
    "Real Fabric prerequisite validation did not pass.",
  );
  return result;
}

const fabric = await runPhase6FabricValidator();
const [admin, auditor, outsider] = await Promise.all([
  login(adminEmail),
  login(auditorEmail),
  login(outsiderEmail),
]);

await request(`/api/v1/cases/not-a-uuid/ledger-summary`, {
  token: admin,
  expected: [400],
});
const summary = await request(`/api/v1/cases/${fabric.caseId}/ledger-summary`, {
  token: auditor,
});
check(summary.caseId === fabric.caseId, "Summary returned the wrong case.");
check(summary.state === "ANCHORED", "Case proof state is not ANCHORED.");
check(
  summary.ledgerAvailability.available &&
    summary.ledgerAvailability.providerType === "FABRIC",
  "Summary did not report the real Fabric provider as available.",
);
check(
  summary.evidenceCounts.confirmed === 1 &&
    summary.evidenceCounts.eligible === 1,
  "Evidence proof counts do not match the case fixture.",
);
check(
  summary.decision.lifecycle === "CONFIRMED",
  "Decision proof summary is not confirmed.",
);
check(
  summary.latestVerification &&
    summary.latestVerification.offLedgerHash === "MATCH" &&
    summary.latestVerification.ledgerConfirmation === "CONFIRMED" &&
    summary.latestVerification.ledgerHash === "MATCH",
  "Summary collapsed or lost a verification dimension.",
);
check(
  new Date(summary.freshness.staleAfter) >
    new Date(summary.freshness.generatedAt),
  "Summary freshness metadata is invalid.",
);

const firstPage = await request(
  `/api/v1/cases/${fabric.caseId}/proofs?pageSize=1`,
  { token: auditor },
);
check(firstPage.items.length === 1, "First proof page size is unstable.");
check(Boolean(firstPage.nextCursor), "First proof page has no cursor.");
const secondPage = await request(
  `/api/v1/cases/${fabric.caseId}/proofs?pageSize=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
  { token: auditor },
);
check(secondPage.items.length === 1, "Second proof page is missing.");
check(
  secondPage.items[0].proofRequestId !== firstPage.items[0].proofRequestId,
  "Cursor pagination returned a duplicate proof.",
);
const allProofs = [...firstPage.items, ...secondPage.items];
check(
  new Set(allProofs.map((proof) => proof.proofType)).size === 2,
  "Case proof list did not include evidence and decision proof types.",
);
for (const proof of allProofs) {
  check(proof.lifecycle === "CONFIRMED", "A Fabric proof is not confirmed.");
  check(
    proof.provider.providerType === "FABRIC" &&
      Boolean(proof.provider.transactionId),
    "A proof is missing its opaque Fabric transaction binding.",
  );
  for (const forbidden of [
    "channelName",
    "chaincodeName",
    "mspId",
    "certificate",
    "privateKey",
    "peer",
    "blockNumber",
  ])
    check(
      !Object.hasOwn(proof.provider, forbidden),
      `Provider view leaked ${forbidden}.`,
    );
}
const evidenceOnly = await request(
  `/api/v1/cases/${fabric.caseId}/proofs?proofType=EVIDENCE&status=CONFIRMED`,
  { token: auditor },
);
check(
  evidenceOnly.items.length === 1 &&
    evidenceOnly.items[0].evidenceVersionId === fabric.evidenceVersionId,
  "Proof filters did not preserve exact Evidence Version identity.",
);
await request(
  `/api/v1/cases/${fabric.caseId}/proofs?pageSize=1&cursor=${encodeURIComponent(`${firstPage.nextCursor}tampered`)}`,
  { token: auditor, expected: [400] },
);
await request(`/api/v1/cases/${fabric.caseId}/ledger-summary`, {
  token: outsider,
  expected: [403, 404],
});
await request(`/api/v1/cases/${fabric.caseId}/decision-proof`, {
  method: "POST",
  token: auditor,
  expected: [403],
  headers: { "idempotency-key": `auditor-denied-${Date.now()}` },
  json: {},
});
await request(
  `/api/v1/ledger/proofs/${firstPage.items[0].proofRequestId}/retry`,
  { method: "POST", token: auditor, expected: [403], json: {} },
);
const verification = await request(
  `/api/v1/evidence/${fabric.evidenceId}/versions/${fabric.evidenceVersionId}/proofs/verify`,
  { method: "POST", token: auditor, json: {} },
);
check(
  verification.offLedgerStatus === "OFF_LEDGER_HASH_MATCH" &&
    verification.ledgerProofStatus === "LEDGER_PROOF_CONFIRMED" &&
    verification.ledgerHashStatus === "LEDGER_HASH_MATCH",
  "Auditor verification did not reach the real Fabric proof.",
);

console.log(
  JSON.stringify({
    result: "PASS Phase 6.1 Case Ledger UI Integration validation",
    assertions,
    caseId: fabric.caseId,
    evidenceId: fabric.evidenceId,
    evidenceVersionId: fabric.evidenceVersionId,
    evidenceTransactionId: fabric.evidenceTransactionId,
    decisionTransactionId: fabric.decisionTransactionId,
  }),
);
