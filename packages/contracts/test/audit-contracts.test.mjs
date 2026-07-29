import assert from "node:assert/strict";
import test from "node:test";
import {
  auditExportRequestSchema,
  auditOperationRequestSchema,
  auditReportRequestSchema,
  auditSearchQuerySchema,
} from "../dist/index.js";

test("audit search rejects unknown fields and oversized pages", () => {
  assert.equal(
    auditSearchQuerySchema.safeParse({ pageSize: 100 }).success,
    true,
  );
  assert.equal(
    auditSearchQuerySchema.safeParse({ pageSize: 101 }).success,
    false,
  );
  assert.equal(
    auditSearchQuerySchema.safeParse({ tenantId: "untrusted" }).success,
    false,
  );
});

test("report requests permit only approved versioned definitions", () => {
  assert.equal(
    auditReportRequestSchema.safeParse({
      reportKey: "HUMAN_DECISION_SUMMARY",
      parameters: {},
    }).success,
    true,
  );
  assert.equal(
    auditReportRequestSchema.safeParse({
      reportKey: "SELECT_FROM_AUDIT",
      parameters: { sql: "select *" },
    }).success,
    false,
  );
});

test("exports are bounded to CSV or JSON and strict approved filters", () => {
  assert.equal(
    auditExportRequestSchema.safeParse({
      format: "CSV",
      filters: { outcome: "SUCCESS" },
    }).success,
    true,
  );
  assert.equal(
    auditExportRequestSchema.safeParse({
      format: "XLSX",
      filters: {},
    }).success,
    false,
  );
  assert.equal(
    auditExportRequestSchema.safeParse({
      format: "JSON",
      filters: { objectKey: "../../secret" },
    }).success,
    false,
  );
});

test("operator actions are enumerated and require a meaningful reason", () => {
  assert.equal(
    auditOperationRequestSchema.safeParse({
      type: "RECONCILIATION",
      reason: "Verify the current tenant projection.",
    }).success,
    true,
  );
  assert.equal(
    auditOperationRequestSchema.safeParse({
      type: "TRUNCATE",
      reason: "Delete data now.",
    }).success,
    false,
  );
  assert.equal(
    auditOperationRequestSchema.safeParse({
      type: "REPLAY",
      reason: "short",
    }).success,
    false,
  );
});
