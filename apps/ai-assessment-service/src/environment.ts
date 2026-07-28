import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3006),
    DATABASE_URL: z.string().min(1),
    CASE_SERVICE_URL: z.string().url(),
    EVIDENCE_SERVICE_URL: z.string().url(),
    WORKFLOW_SERVICE_URL: z.string().url(),
    IDENTITY_SERVICE_URL: z.string().url(),
    JWT_JWKS_URL: z.string().url(),
    JWT_ISSUER: z.string().default("cdep-identity-access-service"),
    JWT_AUDIENCE: z.string().default("cdep-api"),
    INTERNAL_SERVICE_TOKEN: z.string().min(32),
    AI_ADAPTER_MODE: z.enum(["MOCK", "CORTEX"]).default("MOCK"),
    AI_ASSESSMENTS_ENABLED: booleanValue.default(true),
    AI_WORKER_ENABLED: booleanValue.default(true),
    AI_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(500),
    AI_WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).default(60),
    AI_OUTPUT_ENCRYPTION_KEY: z.string().min(32),
    KAFKA_BROKERS: z
      .string()
      .transform((value) => value.split(",").map((item) => item.trim())),
    KAFKA_CLIENT_ID: z.string().default("cdep-ai-assessment-service"),
    KAFKA_SECURITY_PROTOCOL: z
      .enum(["PLAINTEXT", "SSL", "SASL_SSL"])
      .default("PLAINTEXT"),
    KAFKA_SASL_MECHANISM: z
      .enum(["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"])
      .default("SCRAM-SHA-512"),
    KAFKA_SASL_USERNAME: z.string().optional(),
    KAFKA_SASL_PASSWORD: z.string().optional(),
    AI_CONSUMER_GROUP: z.string().default("cdep-ai-assessment-v1"),
    OUTBOX_ENABLED: booleanValue.default(true),
  })
  .superRefine((value, context) => {
    if (value.AI_ADAPTER_MODE === "CORTEX")
      context.addIssue({
        code: "custom",
        message:
          "AI_ADAPTER_MODE=CORTEX is deferred until the real Cortex contract is supplied.",
      });
    if (
      value.NODE_ENV === "production" &&
      value.AI_ASSESSMENTS_ENABLED &&
      value.AI_ADAPTER_MODE === "MOCK"
    )
      context.addIssue({
        code: "custom",
        message:
          "MockCortexGateway cannot be enabled for assessments in production.",
      });
    if (
      value.KAFKA_SECURITY_PROTOCOL === "SASL_SSL" &&
      (!value.KAFKA_SASL_USERNAME || !value.KAFKA_SASL_PASSWORD)
    )
      context.addIssue({
        code: "custom",
        message: "Kafka SASL credentials are required for SASL_SSL.",
      });
  });

export type AiEnvironment = z.output<typeof schema>;
let cached: AiEnvironment | undefined;
export function getEnvironment() {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Invalid ai-assessment-service configuration:\n${z.prettifyError(result.error)}`,
    );
  cached = result.data;
  return cached;
}

export function resetEnvironmentForTest() {
  cached = undefined;
}
