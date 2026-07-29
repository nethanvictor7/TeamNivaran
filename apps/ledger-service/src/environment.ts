import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3007),
    DATABASE_URL: z.string().min(1),
    LEDGER_PROVIDER: z.enum(["FABRIC", "GCUL", "MOCK"]).default("FABRIC"),
    LEDGER_WORKER_ENABLED: booleanValue.default(true),
    LEDGER_WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .default(500),
    LEDGER_WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).default(60),
    LEDGER_RETRY_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5),
    CASE_SERVICE_URL: z.string().url(),
    EVIDENCE_SERVICE_URL: z.string().url(),
    WORKFLOW_SERVICE_URL: z.string().url(),
    JWT_JWKS_URL: z.string().url(),
    JWT_ISSUER: z.string().default("cdep-identity-access-service"),
    JWT_AUDIENCE: z.string().default("cdep-api"),
    INTERNAL_SERVICE_TOKEN: z.string().min(32),
    FABRIC_CHANNEL_NAME: z.string().min(1).default("cdep-proof-channel"),
    FABRIC_CHAINCODE_NAME: z.string().min(1).default("cdep-proof-registry"),
    FABRIC_MSP_ID: z.string().min(1).default("CDEPMSP"),
    FABRIC_GATEWAY_ENDPOINT: z
      .string()
      .min(1)
      .default("peer0.cdep.example.com:7051"),
    FABRIC_GATEWAY_SERVER_NAME: z
      .string()
      .min(1)
      .default("peer0.cdep.example.com"),
    FABRIC_GATEWAY_TLS_CERT_PATH: z
      .string()
      .min(1)
      .default("/fabric/crypto/cdep/tls/ca.crt"),
    FABRIC_IDENTITY_CERT_PATH: z
      .string()
      .min(1)
      .default(
        "/fabric/crypto/cdep/users/Admin@cdep.example.com/msp/signcerts/Admin@cdep.example.com-cert.pem",
      ),
    FABRIC_IDENTITY_KEY_PATH: z
      .string()
      .min(1)
      .default(
        "/fabric/crypto/cdep/users/Admin@cdep.example.com/msp/keystore/priv_sk",
      ),
    FABRIC_COMMIT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    KAFKA_BROKERS: z
      .string()
      .transform((value) => value.split(",").map((item) => item.trim())),
    KAFKA_CLIENT_ID: z.string().default("cdep-ledger-service"),
    OUTBOX_ENABLED: booleanValue.default(true),
  })
  .superRefine((value, context) => {
    if (value.LEDGER_PROVIDER === "GCUL")
      context.addIssue({
        code: "custom",
        message:
          "LEDGER_PROVIDER=GCUL is deferred until the authoritative GCUL SDK, signing, contract, and finality contract are supplied.",
      });
    if (value.LEDGER_PROVIDER === "MOCK" && value.NODE_ENV !== "test")
      context.addIssue({
        code: "custom",
        message: "MockLedgerProvider is restricted to automated tests.",
      });
  });

export type LedgerEnvironment = z.output<typeof schema>;
let cached: LedgerEnvironment | undefined;

export function getEnvironment() {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Invalid ledger-service configuration:\n${z.prettifyError(result.error)}`,
    );
  cached = result.data;
  return cached;
}

export function resetEnvironmentForTest() {
  cached = undefined;
}
