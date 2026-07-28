import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  IDENTITY_SERVICE_URL: z.string().url().default("http://localhost:3001"),
  CASE_SERVICE_URL: z.string().url().default("http://localhost:3002"),
  INTEGRATION_SERVICE_URL: z.string().url().default("http://localhost:3003"),
  EVIDENCE_SERVICE_URL: z.string().url().default("http://localhost:3004"),
  WORKFLOW_SERVICE_URL: z.string().url().default("http://localhost:3005"),
  AI_ASSESSMENT_SERVICE_URL: z.string().url().default("http://localhost:3006"),
  LEDGER_SERVICE_URL: z.string().url().default("http://localhost:3007"),
  EVIDENCE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(10485760),
  JWT_JWKS_URL: z
    .string()
    .url()
    .default("http://localhost:3001/api/v1/auth/jwks"),
  JWT_ISSUER: z.string().default("cdep-identity-access-service"),
  JWT_AUDIENCE: z.string().default("cdep-api"),
});

export function getEnvironment(): z.output<typeof schema> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid API Gateway configuration:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
