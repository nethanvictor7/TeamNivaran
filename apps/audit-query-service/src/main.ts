import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
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
        "req.headers.idempotency-key",
        "body",
      ],
    },
    genReqId: (request: IncomingMessage) => {
      const incoming = request.headers["x-correlation-id"];
      return typeof incoming === "string" && incoming.length <= 128
        ? incoming
        : randomUUID();
    },
    bodyLimit: 128 * 1024,
    requestTimeout: 30_000,
  }),
);
app.enableShutdownHooks();
app.useGlobalFilters(new ProblemFilter());
const fastify = app.getHttpAdapter().getInstance();
fastify.addHook("onSend", async (request, reply) => {
  void reply.header("x-correlation-id", request.id);
  void reply.header("cache-control", "no-store");
  void reply.header("x-content-type-options", "nosniff");
  void reply.header("content-security-policy", "default-src 'none'");
});
await app.listen(environment.PORT, "0.0.0.0");
