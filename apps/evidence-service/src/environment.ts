import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3004),
    EVIDENCE_SERVICE_PORT: z.coerce.number().int().positive().optional(),
    DATABASE_URL: z.string().min(1),
    EVIDENCE_DATABASE_URL: z.string().min(1).optional(),
    CASE_SERVICE_URL: z.string().url(),
    JWT_JWKS_URL: z.string().url(),
    JWKS_URL: z.string().url().optional(),
    JWT_ISSUER: z.string().default("cdep-identity-access-service"),
    JWT_AUDIENCE: z.string().default("cdep-api"),
    INTERNAL_SERVICE_TOKEN: z.string().min(32),
    KAFKA_BROKERS: z
      .string()
      .transform((value) => value.split(",").map((item) => item.trim())),
    KAFKA_CLIENT_ID: z.string().default("cdep-evidence-service"),
    KAFKA_SECURITY_PROTOCOL: z
      .enum(["PLAINTEXT", "SSL", "SASL_SSL"])
      .default("PLAINTEXT"),
    KAFKA_SASL_MECHANISM: z
      .enum(["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"])
      .default("SCRAM-SHA-512"),
    KAFKA_SASL_USERNAME: z.string().optional(),
    KAFKA_SASL_PASSWORD: z.string().optional(),
    OUTBOX_ENABLED: booleanValue.default(true),
    OBJECT_STORAGE_ENDPOINT: z.string().url(),
    OBJECT_STORAGE_PUBLIC_ENDPOINT: z.string().url().optional(),
    OBJECT_STORAGE_REGION: z.string().min(1),
    OBJECT_STORAGE_QUARANTINE_BUCKET: z.string().min(3),
    OBJECT_STORAGE_EVIDENCE_BUCKET: z.string().min(3),
    OBJECT_STORAGE_ACCESS_KEY: z.string().min(8),
    OBJECT_STORAGE_SECRET_KEY: z.string().min(16),
    OBJECT_STORAGE_FORCE_PATH_STYLE: booleanValue.default(true),
    OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(15)
      .max(300)
      .default(60),
    CLAMAV_HOST: z.string().min(1),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    EVIDENCE_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(10485760),
    EVIDENCE_ALLOWED_MEDIA_TYPES: z
      .string()
      .default("application/pdf,image/png,image/jpeg,text/plain")
      .transform(
        (value) =>
          new Set(value.split(",").map((item) => item.trim().toLowerCase())),
      ),
    EVIDENCE_PROCESSING_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3),
    EVIDENCE_PROCESSING_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .default(60),
    EVIDENCE_ORPHAN_SAFETY_PERIOD_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .default(24),
    EVIDENCE_WORKER_POLL_MS: z.coerce.number().int().min(100).default(750),
  })
  .superRefine((value, context) => {
    if (
      value.KAFKA_SECURITY_PROTOCOL === "SASL_SSL" &&
      (!value.KAFKA_SASL_USERNAME || !value.KAFKA_SASL_PASSWORD)
    ) {
      context.addIssue({
        code: "custom",
        message: "Kafka SASL username and password are required for SASL_SSL.",
      });
    }
  });

export type EvidenceEnvironment = z.output<typeof schema>;

let cached: EvidenceEnvironment | undefined;
export function getEnvironment(): EvidenceEnvironment {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Invalid evidence-service configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  cached = result.data;
  return cached;
}

export function resetEnvironmentForTest() {
  cached = undefined;
}
