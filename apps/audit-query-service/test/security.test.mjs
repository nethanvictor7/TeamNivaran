import assert from "node:assert/strict";
import test from "node:test";
import {
  auditRecordHash,
  canonicalJson,
  csvRow,
  decodeCursor,
  encodeCursor,
  sanitizeAuditMetadata,
  sha256,
} from "../dist/src/audit-crypto.js";

const secret = "cdep-test-cursor-signing-secret-at-least-32-characters";
const organizationId = "10000000-0000-4000-8000-000000000001";
const filtersHash = sha256("bounded-filter");

test("canonical audit material is deterministic across key order", () => {
  assert.equal(
    canonicalJson({ z: 2, a: { y: true, x: null } }),
    canonicalJson({ a: { x: null, y: true }, z: 2 }),
  );
  assert.equal(
    auditRecordHash({ z: 2, a: 1 }),
    auditRecordHash({ a: 1, z: 2 }),
  );
});

test("audit metadata removes credentials and bounds untrusted values", () => {
  const sanitized = sanitizeAuditMetadata({
    caseId: "case-1",
    password: "never-store",
    authorization: "Bearer never-store",
    nested: { privateKey: "never-store", value: "safe" },
    oversized: "x".repeat(1_000),
  });
  assert.equal(sanitized.caseId, "case-1");
  assert.equal("password" in sanitized, false);
  assert.equal("authorization" in sanitized, false);
  assert.deepEqual(sanitized.nested, { value: "safe" });
  assert.equal(sanitized.oversized.length, 500);
});

test("cursor is tenant- and filter-bound and rejects tampering", () => {
  const cursor = encodeCursor(
    {
      organizationId,
      filtersHash,
      occurredAt: "2026-07-28T00:00:00.000Z",
      id: "20000000-0000-4000-8000-000000000002",
    },
    secret,
  );
  assert.equal(
    decodeCursor(cursor, { organizationId, filtersHash }, secret).id,
    "20000000-0000-4000-8000-000000000002",
  );
  assert.throws(() =>
    decodeCursor(
      cursor,
      {
        organizationId: "30000000-0000-4000-8000-000000000003",
        filtersHash,
      },
      secret,
    ),
  );
  assert.throws(() =>
    decodeCursor(
      cursor,
      { organizationId, filtersHash: sha256("changed-filter") },
      secret,
    ),
  );
  assert.throws(() =>
    decodeCursor(`${cursor}tampered`, { organizationId, filtersHash }, secret),
  );
});

test("CSV output neutralizes spreadsheet formula injection", () => {
  const row = csvRow(["=1+1", "+SUM(A1)", "-2+3", "@cmd", "safe"]);
  assert.match(row, /^"'=1\+1","'\+SUM\(A1\)","'-2\+3","'@cmd","safe"$/);
});
