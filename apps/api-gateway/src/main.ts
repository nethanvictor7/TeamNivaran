import "reflect-metadata";
import httpProxy from "@fastify/http-proxy";
import rateLimit from "@fastify/rate-limit";
import replyFrom from "@fastify/reply-from";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppModule } from "./app.module.js";
import { getEnvironment } from "./environment.js";

const environment = getEnvironment();
const jwks = createRemoteJWKSet(new URL(environment.JWT_JWKS_URL), {
  cooldownDuration: 30_000,
  cacheMaxAge: 300_000,
  timeoutDuration: 2_000,
});

const adapter = new FastifyAdapter({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-cdep-webhook-key",
      "res.headers.set-cookie",
    ],
  },
  genReqId: (request: IncomingMessage) => {
    const incoming = request.headers["x-correlation-id"];
    return typeof incoming === "string" && incoming.length <= 128
      ? incoming
      : randomUUID();
  },
  bodyLimit: environment.EVIDENCE_MAX_UPLOAD_BYTES + 64 * 1024,
  requestTimeout: 120_000,
});
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  adapter,
);
app.enableShutdownHooks();
const fastify = app.getHttpAdapter().getInstance();
fastify.addContentTypeParser(
  /^multipart\/form-data/i,
  (_request, payload, done) => {
    done(null, payload);
  },
);

await fastify.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  allowList: (request: FastifyRequest) => request.url.startsWith("/health/"),
});
await fastify.register(replyFrom, {
  undici: { headersTimeout: 120_000, bodyTimeout: 120_000 },
});

const publicRoutes = new Set([
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/logout",
  "GET /api/v1/auth/jwks",
]);
const webhookWindows = new Map<string, { startedAt: number; count: number }>();

fastify.addHook("onRequest", async (request, reply) => {
  delete request.headers["x-user-id"];
  delete request.headers["x-organization-id"];
  delete request.headers["x-user-roles"];
  delete request.headers["x-user-permissions"];
  request.headers["x-correlation-id"] = request.id;

  const routeKey = `${request.method} ${request.url.split("?")[0]}`;
  if (request.url.startsWith("/api/v1/integration/hooks/")) {
    const now = Date.now();
    const connectorKey =
      request.url.split("?")[0]!.split("/").at(-1) ?? "unknown";
    const clientKey = `${connectorKey}:${request.ip}`;
    const current = webhookWindows.get(clientKey);
    if (!current || now - current.startedAt >= 60_000) {
      webhookWindows.set(clientKey, { startedAt: now, count: 1 });
    } else {
      current.count += 1;
      if (current.count > 120) {
        return reply.code(429).send({
          type: "https://cdep.local/problems/rate-limit-exceeded",
          title: "Rate limit exceeded",
          status: 429,
          code: "RATE_LIMIT_EXCEEDED",
          detail: "The public webhook gateway rate limit was exceeded.",
          instance: request.url,
          correlationId: request.id,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
  if (
    request.url.startsWith("/health/") ||
    request.url.startsWith("/api/v1/integration/hooks/") ||
    publicRoutes.has(routeKey)
  ) {
    return;
  }
  if (!request.url.startsWith("/api/")) {
    return;
  }

  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : undefined;
  if (!token) {
    return reply.code(401).send({
      type: "https://cdep.local/problems/authentication-required",
      title: "Authentication required",
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      detail: "A valid bearer access token is required.",
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: environment.JWT_ISSUER,
      audience: environment.JWT_AUDIENCE,
    });
    if (
      payload.token_type !== "access" ||
      typeof payload.sub !== "string" ||
      typeof payload.org_id !== "string"
    ) {
      throw new Error("Unexpected access-token claims.");
    }
    request.headers["x-user-id"] = payload.sub;
    request.headers["x-organization-id"] = payload.org_id;
    request.headers["x-user-roles"] = Array.isArray(payload.roles)
      ? payload.roles.join(",")
      : "";
    request.headers["x-user-permissions"] = Array.isArray(payload.permissions)
      ? payload.permissions.join(",")
      : "";
  } catch {
    return reply.code(401).send({
      type: "https://cdep.local/problems/invalid-access-token",
      title: "Invalid access token",
      status: 401,
      code: "INVALID_ACCESS_TOKEN",
      detail: "The bearer token is invalid or expired.",
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
});

fastify.addHook("onSend", async (request, reply) => {
  void reply.header("x-correlation-id", request.id);
  void reply.header("x-content-type-options", "nosniff");
  void reply.header("referrer-policy", "no-referrer");
  void reply.header(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
});

fastify.get("/health/live", async () => ({
  status: "ok",
  service: "api-gateway",
}));
fastify.get("/health/startup", async () => ({
  status: "ok",
  service: "api-gateway",
}));
fastify.get("/health/ready", async (_request, reply) => {
  try {
    const [
      identity,
      cases,
      integration,
      evidence,
      workflow,
      aiAssessment,
      ledger,
      audit,
    ] = await Promise.all([
      fetch(`${environment.IDENTITY_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(2_000),
      }),
      fetch(`${environment.CASE_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(2_000),
      }),
      fetch(`${environment.INTEGRATION_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(2_000),
      }),
      fetch(`${environment.EVIDENCE_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      }),
      fetch(`${environment.WORKFLOW_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      }),
      fetch(`${environment.AI_ASSESSMENT_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      }),
      fetch(`${environment.LEDGER_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      }),
      fetch(`${environment.AUDIT_SERVICE_URL}/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      }),
    ]);
    if (
      !identity.ok ||
      !cases.ok ||
      !integration.ok ||
      !evidence.ok ||
      !workflow.ok ||
      !aiAssessment.ok ||
      !ledger.ok ||
      !audit.ok
    ) {
      throw new Error("A gateway dependency is unavailable.");
    }
    return {
      status: "ok",
      dependencies: {
        identityAccess: "up",
        caseService: "up",
        integrationService: "up",
        evidenceService: "up",
        workflowService: "up",
        aiAssessmentService: "up",
        ledgerService: "up",
        auditQueryService: "up",
      },
    };
  } catch {
    return reply.code(503).send({
      status: "unavailable",
      dependencies: {
        identityAccess: "unknown",
        caseService: "unknown",
        integrationService: "unknown",
        evidenceService: "unknown",
        workflowService: "unknown",
        aiAssessmentService: "unknown",
        ledgerService: "unknown",
        auditQueryService: "unknown",
      },
    });
  }
});

await fastify.register(httpProxy, {
  upstream: environment.IDENTITY_SERVICE_URL,
  prefix: "/api/v1/auth",
  rewritePrefix: "/api/v1/auth",
  http2: false,
});

await fastify.register(httpProxy, {
  upstream: environment.AUDIT_SERVICE_URL,
  prefix: "/api/v1/audit",
  rewritePrefix: "/api/v1/audit",
  http2: false,
  replyOptions: {
    onError(reply) {
      reply.code(503).send({
        type: "https://cdep.local/problems/service-unavailable",
        title: "Audit service unavailable",
        status: 503,
        code: "AUDIT_SERVICE_UNAVAILABLE",
        detail:
          "The audit and reporting service could not process the request.",
        instance: reply.request.url,
        correlationId: reply.request.id,
        timestamp: new Date().toISOString(),
      });
    },
  },
});

const ledgerProxy = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    return await reply.from(`${environment.LEDGER_SERVICE_URL}${request.url}`);
  } catch {
    return reply.code(503).send({
      type: "https://cdep.local/problems/service-unavailable",
      title: "Ledger service unavailable",
      status: 503,
      code: "LEDGER_SERVICE_UNAVAILABLE",
      detail: "The ledger service could not process the request.",
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
};
const ledgerCaseParams = z.object({ caseId: z.uuid() });
const ledgerCaseProofQuery = z
  .object({
    proofType: z.enum(["EVIDENCE", "DECISION"]).optional(),
    status: z.enum(["PENDING", "SUBMITTED", "CONFIRMED", "FAILED"]).optional(),
    evidenceId: z.uuid().optional(),
    evidenceVersionId: z.uuid().optional(),
    providerType: z
      .string()
      .regex(/^[A-Z][A-Z0-9_-]{1,29}$/)
      .optional(),
    cursor: z.string().min(1).max(2048).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
const invalidLedgerRead = (request: FastifyRequest, reply: FastifyReply) =>
  reply.code(400).send({
    type: "https://cdep.local/problems/invalid-ledger-read",
    title: "Invalid ledger read request",
    status: 400,
    code: "INVALID_LEDGER_READ_REQUEST",
    detail: "The case identifier or proof-list filters are invalid.",
    instance: request.url,
    correlationId: request.id,
    timestamp: new Date().toISOString(),
  });
fastify.get("/api/v1/cases/:caseId/ledger-summary", async (request, reply) => {
  if (!ledgerCaseParams.safeParse(request.params).success)
    return invalidLedgerRead(request, reply);
  return ledgerProxy(request, reply);
});
fastify.get("/api/v1/cases/:caseId/proofs", async (request, reply) => {
  if (
    !ledgerCaseParams.safeParse(request.params).success ||
    !ledgerCaseProofQuery.safeParse(request.query).success
  )
    return invalidLedgerRead(request, reply);
  return ledgerProxy(request, reply);
});
fastify.all(
  "/api/v1/evidence/:evidenceId/versions/:versionId/proofs",
  ledgerProxy,
);
fastify.all(
  "/api/v1/evidence/:evidenceId/versions/:versionId/proofs/verify",
  ledgerProxy,
);
fastify.all("/api/v1/cases/:caseId/decision-proof", ledgerProxy);
fastify.all("/api/v1/cases/:caseId/decision-proof/verify", ledgerProxy);
fastify.all("/api/v1/ledger/*", ledgerProxy);

const evidenceCaseProxy = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    return await reply.from(
      `${environment.EVIDENCE_SERVICE_URL}${request.url}`,
    );
  } catch {
    return reply.code(503).send({
      type: "https://cdep.local/problems/service-unavailable",
      title: "Evidence service unavailable",
      status: 503,
      code: "EVIDENCE_SERVICE_UNAVAILABLE",
      detail: "The evidence service could not process the request.",
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
};
fastify.all("/api/v1/cases/:caseId/evidence", evidenceCaseProxy);

const workflowProxy = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    return await reply.from(
      `${environment.WORKFLOW_SERVICE_URL}${request.url}`,
    );
  } catch {
    return reply.code(503).send({
      type: "https://cdep.local/problems/service-unavailable",
      title: "Workflow service unavailable",
      status: 503,
      code: "WORKFLOW_SERVICE_UNAVAILABLE",
      detail: "The Workflow service could not process the request.",
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
};
fastify.all("/api/v1/cases/:caseId/workflow", workflowProxy);
fastify.all("/api/v1/cases/:caseId/workflow/*", workflowProxy);
fastify.all("/api/v1/cases/:caseId/recommendations", workflowProxy);
fastify.all("/api/v1/cases/:caseId/decision", workflowProxy);
fastify.all("/api/v1/cases/:caseId/decision/*", workflowProxy);
fastify.all("/api/v1/cases/:caseId/decisions", workflowProxy);
fastify.all("/api/v1/decisions/:decisionId", workflowProxy);
fastify.all("/api/v1/workflow-definitions", workflowProxy);
fastify.all("/api/v1/workflow-definitions/*", workflowProxy);

const aiAssessmentProxy = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    return await reply.from(
      `${environment.AI_ASSESSMENT_SERVICE_URL}${request.url}`,
    );
  } catch {
    return reply.code(503).send({
      type: "https://cdep.local/problems/service-unavailable",
      title: "AI assessment service unavailable",
      status: 503,
      code: "AI_ASSESSMENT_SERVICE_UNAVAILABLE",
      detail: "The AI assessment service could not process the request.",
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
};
fastify.all("/api/v1/cases/:caseId/ai-assessments", aiAssessmentProxy);
fastify.all("/api/v1/ai-assessments/:assessmentId", aiAssessmentProxy);
fastify.all("/api/v1/ai-assessments/:assessmentId/*", aiAssessmentProxy);
fastify.all("/api/v1/ai-governance", aiAssessmentProxy);
fastify.all("/api/v1/ai-governance/*", aiAssessmentProxy);

await fastify.register(httpProxy, {
  upstream: environment.WORKFLOW_SERVICE_URL,
  prefix: "/api/v1/workflow",
  rewritePrefix: "/api/v1/workflow",
  http2: false,
});

await fastify.register(httpProxy, {
  upstream: environment.CASE_SERVICE_URL,
  prefix: "/api/v1/cases",
  rewritePrefix: "/api/v1/cases",
  http2: false,
  replyOptions: {
    onError(reply) {
      reply.code(503).send({
        type: "https://cdep.local/problems/service-unavailable",
        title: "Case service unavailable",
        status: 503,
        code: "CASE_SERVICE_UNAVAILABLE",
        detail: "The case service could not process the request.",
        instance: reply.request.url,
        correlationId: reply.request.id,
        timestamp: new Date().toISOString(),
      });
    },
  },
});

await fastify.register(httpProxy, {
  upstream: environment.INTEGRATION_SERVICE_URL,
  prefix: "/api/v1/integration",
  rewritePrefix: "/api/v1/integration",
  http2: false,
});

await fastify.register(httpProxy, {
  upstream: environment.EVIDENCE_SERVICE_URL,
  prefix: "/api/v1/evidence",
  rewritePrefix: "/api/v1/evidence",
  http2: false,
  replyOptions: {
    onError(reply) {
      reply.code(503).send({
        type: "https://cdep.local/problems/service-unavailable",
        title: "Evidence service unavailable",
        status: 503,
        code: "EVIDENCE_SERVICE_UNAVAILABLE",
        detail: "The evidence service could not process the request.",
        instance: reply.request.url,
        correlationId: reply.request.id,
        timestamp: new Date().toISOString(),
      });
    },
  },
});

await app.listen(environment.PORT, "0.0.0.0");
