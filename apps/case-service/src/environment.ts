import { z } from "zod";

const booleanValue = z.enum(["true", "false"]).transform((v) => v === "true");
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1),
  JWT_JWKS_URL: z.string().url(),
  JWT_ISSUER: z.string().default("cdep-identity-access-service"),
  JWT_AUDIENCE: z.string().default("cdep-api"),
  KAFKA_BROKERS: z.string().transform((v) => v.split(",").map((x) => x.trim())),
  KAFKA_SECURITY_PROTOCOL: z
    .enum(["PLAINTEXT", "SSL", "SASL_SSL"])
    .default("PLAINTEXT"),
  KAFKA_SASL_MECHANISM: z
    .enum(["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"])
    .optional(),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_ENABLED: booleanValue.default(true),
  INTERNAL_SERVICE_TOKEN: z.string().min(32),
});

export function getEnvironment(): z.output<typeof schema> {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Invalid case-service configuration:\n${z.prettifyError(result.error)}`,
    );
  return result.data;
}
