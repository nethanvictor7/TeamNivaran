import assert from "node:assert/strict";
import test from "node:test";
import {
  getEnvironment,
  resetEnvironmentForTest,
} from "../dist/src/environment.js";

const original = { ...process.env };
const base = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/cdep_ai",
  CASE_SERVICE_URL: "http://localhost:3002",
  EVIDENCE_SERVICE_URL: "http://localhost:3004",
  WORKFLOW_SERVICE_URL: "http://localhost:3005",
  IDENTITY_SERVICE_URL: "http://localhost:3001",
  JWT_JWKS_URL: "http://localhost:3001/api/v1/auth/jwks",
  INTERNAL_SERVICE_TOKEN: "a".repeat(32),
  AI_OUTPUT_ENCRYPTION_KEY: "b".repeat(32),
  KAFKA_BROKERS: "localhost:29092",
};

test.afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTest();
});

test("production refuses enabled MockCortexGateway", () => {
  process.env = {
    ...original,
    ...base,
    NODE_ENV: "production",
    AI_ADAPTER_MODE: "MOCK",
    AI_ASSESSMENTS_ENABLED: "true",
  };
  resetEnvironmentForTest();
  assert.throws(() => getEnvironment(), /cannot be enabled.*production/i);
});

test("CORTEX mode is deferred and fails without a real contract", () => {
  process.env = {
    ...original,
    ...base,
    NODE_ENV: "development",
    AI_ADAPTER_MODE: "CORTEX",
  };
  resetEnvironmentForTest();
  assert.throws(() => getEnvironment(), /deferred.*real Cortex contract/i);
});
