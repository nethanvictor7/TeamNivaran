import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_ISSUER: z.string().default("cdep-identity-access-service"),
  JWT_AUDIENCE: z.string().default("cdep-api"),
  JWT_KEY_ID: z.string().default("cdep-local-2026-01"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(300).default(604_800),
  JWT_ALLOW_EPHEMERAL_KEYS: booleanValue.default(false),
  JWT_PRIVATE_KEY_BASE64: z.string().optional(),
  JWT_PUBLIC_KEY_BASE64: z.string().optional(),
  REFRESH_COOKIE_SECURE: booleanValue.default(true),
  INTERNAL_SERVICE_TOKEN: z.string().min(32),
});

export type IdentityEnvironment = z.output<typeof environmentSchema>;

export function getEnvironment(): IdentityEnvironment {
  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid identity service configuration:\n${z.prettifyError(parsed.error)}`,
    );
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    (!parsed.data.JWT_PRIVATE_KEY_BASE64 || !parsed.data.JWT_PUBLIC_KEY_BASE64)
  ) {
    throw new Error(
      "Production requires JWT_PRIVATE_KEY_BASE64 and JWT_PUBLIC_KEY_BASE64.",
    );
  }
  return parsed.data;
}
