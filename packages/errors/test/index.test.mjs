import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorSchema, createApiError } from "../dist/index.js";

test("creates a valid correlated API problem response", () => {
  const error = createApiError(
    403,
    "PERMISSION_DENIED",
    "Permission denied",
    "The caller does not have decision:approve.",
    "/api/v1/decisions/1",
    "138f7bce-1f13-4ed2-8eac-ae5e47e55aba",
  );
  assert.equal(apiErrorSchema.parse(error).code, "PERMISSION_DENIED");
});
