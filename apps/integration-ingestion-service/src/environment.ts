import { z } from "zod";

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3003),
    DATABASE_URL: z.string().min(1),
    JWT_JWKS_URL: z.string().url(),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    CASE_SERVICE_URL: z.string().url(),
    INTERNAL_SERVICE_TOKEN: z.string().min(32),
    KAFKA_BROKERS: z
      .string()
      .transform((value) => value.split(",").map((item) => item.trim())),
    KAFKA_SECURITY_PROTOCOL: z
      .enum(["PLAINTEXT", "SSL", "SASL_SSL"])
      .default("PLAINTEXT"),
    KAFKA_SASL_MECHANISM: z
      .enum(["SCRAM-SHA-256", "SCRAM-SHA-512"])
      .default("SCRAM-SHA-512"),
    KAFKA_SASL_USERNAME: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    KAFKA_SASL_PASSWORD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    CONNECTOR_SECRET_PROVIDER: z.enum(["local", "external"]).default("local"),
    CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: z.string().min(43),
    CONNECTOR_CREDENTIAL_KEY_ID: z.string().min(1),
    WEBHOOK_MAX_BODY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(1_048_576),
    SQL_POLL_DEFAULT_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .default(100),
    SQL_POLL_MAX_BATCH_SIZE: z.coerce.number().int().positive().default(1000),
    SQL_POLL_MAX_INITIAL_LOOKBACK_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10_080),
    SQL_POLL_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
    SQL_POLL_FAILURE_PAUSE_THRESHOLD: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
  })
  .superRefine((value, context) => {
    if (
      value.KAFKA_SECURITY_PROTOCOL === "SASL_SSL" &&
      (!value.KAFKA_SASL_USERNAME || !value.KAFKA_SASL_PASSWORD)
    ) {
      context.addIssue({
        code: "custom",
        path: ["KAFKA_SASL_USERNAME"],
        message: "Kafka SASL username and password are required for SASL_SSL.",
      });
    }
  });

export type Environment = z.infer<typeof schema>;
let cached: Environment | undefined;
export const env = (): Environment => {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  cached = parsed.data;
  return cached;
};
