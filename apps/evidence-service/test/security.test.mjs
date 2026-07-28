import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

Object.assign(process.env, {
  PORT: "3004",
  DATABASE_URL: "postgresql://unused:unused@localhost/unused",
  CASE_SERVICE_URL: "http://localhost:3002",
  JWT_JWKS_URL: "http://localhost:3001/jwks",
  JWT_ISSUER: "test",
  JWT_AUDIENCE: "test",
  INTERNAL_SERVICE_TOKEN: "test-internal-service-token-value-123",
  KAFKA_BROKERS: "localhost:9092",
  KAFKA_SECURITY_PROTOCOL: "PLAINTEXT",
  OUTBOX_ENABLED: "false",
  OBJECT_STORAGE_ENDPOINT: "http://localhost:3900",
  OBJECT_STORAGE_REGION: "test",
  OBJECT_STORAGE_QUARANTINE_BUCKET: "test-quarantine",
  OBJECT_STORAGE_EVIDENCE_BUCKET: "test-evidence",
  OBJECT_STORAGE_ACCESS_KEY: "GK0123456789abcdef0123456789abcdef",
  OBJECT_STORAGE_SECRET_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
  CLAMAV_HOST: "localhost",
  CLAMAV_PORT: "3310",
  EVIDENCE_MAX_UPLOAD_BYTES: "1024",
  EVIDENCE_ALLOWED_MEDIA_TYPES: "application/pdf,text/plain",
});

test("filenames reject traversal and control characters", async () => {
  const { sanitizeFilename } = await import("../dist/src/evidence.service.js");
  assert.equal(sanitizeFilename("bank statement.pdf"), "bank statement.pdf");
  assert.throws(() => sanitizeFilename("../statement.pdf"));
  assert.throws(() => sanitizeFilename("bad\nname.pdf"));
  assert.throws(() => sanitizeFilename("folder/name.pdf"));
});

test("stream byte limit rejects content larger than the configured maximum", async () => {
  const { ByteLimitTransform } = await import("../dist/src/object-storage.js");
  const limiter = new ByteLimitTransform(4);
  const source = Readable.from([Buffer.from("123"), Buffer.from("45")]);
  await assert.rejects(async () => {
    for await (const _chunk of source.pipe(limiter)) {
      // consume the bounded stream
    }
  }, /UPLOAD_SIZE_LIMIT_EXCEEDED/);
});

test("integrity comparison is exact and timing-safe for equal-length hashes", async () => {
  const { EvidenceService } = await import("../dist/src/evidence.service.js");
  const one = "a".repeat(64);
  assert.equal(EvidenceService.hashesMatch(one, one), true);
  assert.equal(EvidenceService.hashesMatch(one, "b".repeat(64)), false);
  assert.equal(EvidenceService.hashesMatch(one, "aa"), false);
});

test("upload metadata permits only the configured classification catalogue", async () => {
  const { uploadMetadataSchema } =
    await import("../dist/src/evidence.service.js");
  assert.equal(
    uploadMetadataSchema.safeParse({
      classificationCode: "BANK_STATEMENT",
      title: "Statement",
      declaredSizeBytes: 12,
      reason: "INITIAL",
    }).success,
    true,
  );
  assert.equal(
    uploadMetadataSchema.safeParse({
      classificationCode: "EXECUTABLE",
      title: "Unsafe",
      declaredSizeBytes: 12,
    }).success,
    false,
  );
});
