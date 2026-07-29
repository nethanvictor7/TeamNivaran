import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT, jwtVerify } from "jose";
import { SigningKeyService } from "../dist/src/auth/signing-key.service.js";

test("generates a local RS256 key and verifies a signed token", async () => {
  process.env.DATABASE_URL =
    "postgresql://user:pass@localhost:5432/cdep_identity";
  process.env.JWT_ALLOW_EPHEMERAL_KEYS = "true";
  process.env.REFRESH_COOKIE_SECURE = "false";
  process.env.INTERNAL_SERVICE_TOKEN =
    "identity-test-internal-service-token-0001";

  const service = new SigningKeyService();
  await service.onModuleInit();
  const token = await new SignJWT({ token_type: "access" })
    .setProtectedHeader({ alg: "RS256", kid: service.getKeyId() })
    .setSubject("5ac31606-d3d5-4395-88eb-5d89d458dd41")
    .setIssuer("cdep-identity-access-service")
    .setAudience("cdep-api")
    .setExpirationTime("1m")
    .sign(service.getPrivateKey());

  const result = await jwtVerify(token, service.getPublicKey(), {
    algorithms: ["RS256"],
    issuer: "cdep-identity-access-service",
    audience: "cdep-api",
  });
  assert.equal(result.payload.token_type, "access");
  assert.equal(service.getJwks().keys[0]?.kid, "cdep-local-2026-01");
});
