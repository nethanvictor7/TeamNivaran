import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().positive().default(3005),
    WORKFLOW_SERVICE_PORT: z.coerce.number().int().positive().optional(),
    DATABASE_URL: z.string().min(1),
    WORKFLOW_DATABASE_URL: z.string().min(1).optional(),
    CASE_SERVICE_URL: z.string().url(),
    EVIDENCE_SERVICE_URL: z.string().url(),
    IDENTITY_SERVICE_URL: z.string().url(),
    JWT_JWKS_URL: z.string().url(),
    JWKS_URL: z.string().url().optional(),
    JWT_ISSUER: z.string().default("cdep-identity-access-service"),
    JWT_AUDIENCE: z.string().default("cdep-api"),
    INTERNAL_SERVICE_TOKEN: z.string().min(32),
    KAFKA_BROKERS: z
      .string()
      .transform((value) => value.split(",").map((item) => item.trim())),
    KAFKA_CLIENT_ID: z.string().default("cdep-validation-workflow-service"),
    KAFKA_SECURITY_PROTOCOL: z
      .enum(["PLAINTEXT", "SSL", "SASL_SSL"])
      .default("PLAINTEXT"),
    KAFKA_SASL_MECHANISM: z
      .enum(["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"])
      .default("SCRAM-SHA-512"),
    KAFKA_SASL_USERNAME: z.string().optional(),
    KAFKA_SASL_PASSWORD: z.string().optional(),
    WORKFLOW_CONSUMER_GROUP: z.string().default("cdep-validation-workflow-v1"),
    OUTBOX_ENABLED: booleanValue.default(true),
    WORKFLOW_TASK_DEFAULT_DUE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(720)
      .default(24),
    WORKFLOW_DECISION_DEFAULT_DUE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(720)
      .default(24),
    WORKFLOW_TIMER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(250)
      .default(1000),
    WORKFLOW_TIMER_LEASE_SECONDS: z.coerce.number().int().min(10).default(60),
    WORKFLOW_REVALIDATION_DEBOUNCE_MS: z.coerce
      .number()
      .int()
      .min(100)
      .default(1000),
    WORKFLOW_CASE_SYNC_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5),
    WORKFLOW_CASE_SYNC_RETRY_BASE_MS: z.coerce
      .number()
      .int()
      .min(100)
      .default(1000),
  })
  .superRefine((value, context) => {
    if (
      value.KAFKA_SECURITY_PROTOCOL === "SASL_SSL" &&
      (!value.KAFKA_SASL_USERNAME || !value.KAFKA_SASL_PASSWORD)
    )
      context.addIssue({
        code: "custom",
        message: "Kafka SASL credentials are required for SASL_SSL.",
      });
  });

export type WorkflowEnvironment = z.output<typeof schema>;
let cached: WorkflowEnvironment | undefined;
export function getEnvironment() {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Invalid validation-workflow-service configuration:\n${z.prettifyError(result.error)}`,
    );
  cached = result.data;
  return cached;
}

export function resetEnvironmentForTest() {
  cached = undefined;
}
