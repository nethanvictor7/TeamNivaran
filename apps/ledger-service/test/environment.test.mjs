import assert from "node:assert/strict";
import test from "node:test";
import {
  getEnvironment,
  resetEnvironmentForTest,
} from "../dist/src/environment.js";

const required = {
  DATABASE_URL: "postgresql://test:test@localhost/test",
  CASE_SERVICE_URL: "http://localhost:3002",
  EVIDENCE_SERVICE_URL: "http://localhost:3004",
  WORKFLOW_SERVICE_URL: "http://localhost:3005",
  JWT_JWKS_URL: "http://localhost:3001/api/v1/auth/jwks",
  INTERNAL_SERVICE_TOKEN: "a".repeat(32),
  KAFKA_BROKERS: "localhost:9092",
};

function configured(values) {
  Object.assign(process.env, required, values);
  resetEnvironmentForTest();
}

test("GCUL fails closed until its authoritative contract is supplied", () => {
  configured({ NODE_ENV: "production", LEDGER_PROVIDER: "GCUL" });
  assert.throws(() => getEnvironment(), /GCUL is deferred/);
});

test("mock provider fails closed outside automated tests", () => {
  configured({ NODE_ENV: "production", LEDGER_PROVIDER: "MOCK" });
  assert.throws(() => getEnvironment(), /restricted to automated tests/);
});

test("Fabric is the supported production provider", () => {
  configured({ NODE_ENV: "production", LEDGER_PROVIDER: "FABRIC" });
  assert.equal(getEnvironment().LEDGER_PROVIDER, "FABRIC");
});
