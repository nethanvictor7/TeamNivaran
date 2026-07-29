import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3008),
  DATABASE_URL: z.string().min(1),
  CURSOR_SIGNING_SECRET: z.string().min(32),
  KAFKA_ENABLED: booleanValue.default(true),
  KAFKA_BROKERS: z
    .string()
    .default("localhost:29092")
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  KAFKA_CLIENT_ID: z.string().default("cdep-audit-query-service"),
  KAFKA_GROUP_ID: z.string().default("cdep-audit-authority-v1"),
  KAFKA_SECURITY_PROTOCOL: z
    .enum(["PLAINTEXT", "SSL", "SASL_SSL", "SASL_PLAINTEXT"])
    .default("PLAINTEXT"),
  KAFKA_SASL_MECHANISM: z
    .enum(["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"])
    .default("SCRAM-SHA-512"),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
  KAFKA_TOPICS: z
    .string()
    .default(
      [
        "cdep.case.v1",
        "cdep.integration.lifecycle.v1",
        "cdep.integration.trigger.v1",
        "cdep.evidence.events.v1",
        "cdep.workflow.events.v1",
        "cdep.ai.assessment.v1",
        "cdep.ai.governance.v1",
        "cdep.ledger.proof.v1",
        "cdep.ledger.verification.v1",
        "cdep.ledger.dlt.v1",
      ].join(","),
    )
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  OBJECT_STORAGE_ENDPOINT: z.string().url(),
  OBJECT_STORAGE_PUBLIC_ENDPOINT: z.string().url().optional(),
  OBJECT_STORAGE_REGION: z.string().default("cdep-local"),
  OBJECT_STORAGE_FORCE_PATH_STYLE: booleanValue.default(true),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(3),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(8),
  OBJECT_STORAGE_AUDIT_BUCKET: z
    .string()
    .min(3)
    .default("cdep-audit-artifacts"),
  ARTIFACT_RETENTION_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(8760)
    .default(168),
  DOWNLOAD_GRANT_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(500),
});

export type AuditEnvironment = z.output<typeof schema>;
let cached: AuditEnvironment | undefined;

export function getEnvironment() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid audit-query-service configuration:\n${z.prettifyError(parsed.error)}`,
    );
  cached = parsed.data;
  return cached;
}

export function resetEnvironmentForTest() {
  cached = undefined;
}
