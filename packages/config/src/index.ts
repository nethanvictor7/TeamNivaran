import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const commonServiceEnvironment = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export const databaseEnvironment = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: booleanFromString.default(false),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
});

export const kafkaEnvironment = z.object({
  KAFKA_BROKERS: z
    .string()
    .min(1)
    .transform((value) => value.split(",").map((broker) => broker.trim())),
  KAFKA_SECURITY_PROTOCOL: z
    .enum(["PLAINTEXT", "SSL", "SASL_SSL"])
    .default("PLAINTEXT"),
  KAFKA_SASL_MECHANISM: z
    .enum(["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"])
    .optional(),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
});

export function parseEnvironment<TSchema extends z.ZodType>(
  schema: TSchema,
  environment: NodeJS.ProcessEnv = process.env,
): z.output<TSchema> {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const details = z.prettifyError(result.error);
    throw new Error(`Invalid service configuration:\n${details}`);
  }
  return result.data;
}
