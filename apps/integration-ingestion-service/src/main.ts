import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { env } from "./environment.js";
import { ProblemFilter } from "./problem.filter.js";
const e = env(),
  adapter = new FastifyAdapter({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-cdep-webhook-key",
        "configuration",
        "credentials",
        "payload",
        "body",
      ],
    },
    genReqId: (r: IncomingMessage) =>
      typeof r.headers["x-correlation-id"] === "string"
        ? r.headers["x-correlation-id"]
        : randomUUID(),
    bodyLimit: e.WEBHOOK_MAX_BODY_BYTES,
  });
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  adapter,
);
app.useGlobalFilters(new ProblemFilter());
app.enableShutdownHooks();
const f = app.getHttpAdapter().getInstance();
f.addHook("preParsing", async (r: any, _x: any, payload: any) => {
  const chunks: Buffer[] = [];
  for await (const chunk of payload)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks);
  r.rawBody = raw;
  return Readable.from(raw);
});
f.addHook("onSend", async (r: any, x: any) => {
  x.header("x-correlation-id", r.id);
  x.header("cache-control", "no-store");
});
await app.listen(e.PORT, "0.0.0.0");
