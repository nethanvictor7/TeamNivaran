import "reflect-metadata";
import multipart from "@fastify/multipart";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module.js";
import { getEnvironment } from "./environment.js";
import { ProblemFilter } from "./problem.filter.js";

const environment = getEnvironment();
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-cdep-internal-service-token",
        "objectKey",
        "quarantineKey",
        "canonicalKey",
        "url",
      ],
    },
    genReqId: (request: IncomingMessage) => {
      const incoming = request.headers["x-correlation-id"];
      return typeof incoming === "string" && /^[0-9a-f-]{36}$/i.test(incoming)
        ? incoming
        : randomUUID();
    },
    bodyLimit: environment.EVIDENCE_MAX_UPLOAD_BYTES + 64 * 1024,
    requestTimeout: 120_000,
  }),
);
app.enableShutdownHooks();
app.useGlobalFilters(new ProblemFilter());
await app.register(multipart, {
  limits: {
    fileSize: environment.EVIDENCE_MAX_UPLOAD_BYTES + 1,
    files: 1,
    fields: 12,
    parts: 13,
  },
  throwFileSizeLimit: true,
});
const fastify = app.getHttpAdapter().getInstance();
const windows = new Map<string, { start: number; count: number }>();
fastify.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?")[0] ?? "";
  const limited =
    request.method === "POST" &&
    (path.endsWith("/evidence") ||
      path.endsWith("/versions") ||
      path.endsWith("/download-grant") ||
      path.endsWith("/integrity-checks"));
  if (!limited) return;
  const key = `${request.ip}:${path.replace(/[0-9a-f-]{36}/gi, ":id")}`;
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.start > 60_000) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > 60)
    return reply.code(429).send({
      type: "https://cdep.local/problems/rate-limit-exceeded",
      title: "Rate limit exceeded",
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      detail: "The evidence operation rate limit was exceeded.",
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
});
fastify.addHook("onSend", async (request, reply) => {
  void reply.header("x-correlation-id", request.id);
  void reply.header("cache-control", "no-store");
  void reply.header("x-content-type-options", "nosniff");
  void reply.header("content-security-policy", "default-src 'none'");
});
await app.listen(environment.PORT, "0.0.0.0");
