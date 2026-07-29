import "reflect-metadata";
import cookie from "@fastify/cookie";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { getEnvironment } from "./environment.js";

const environment = getEnvironment();
const adapter = new FastifyAdapter({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "password",
      "refreshToken",
      "accessToken",
    ],
  },
  genReqId: (request: IncomingMessage) => {
    const incoming = request.headers["x-correlation-id"];
    return typeof incoming === "string" && incoming.length <= 128
      ? incoming
      : randomUUID();
  },
  bodyLimit: 1_048_576,
});

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  adapter,
);
await app.register(cookie);
app.enableCors({
  origin: process.env.CORS_ORIGIN?.split(",") ?? [
    "http://localhost:5173",
    "http://localhost:8080",
  ],
  credentials: true,
});
app.enableShutdownHooks();

const fastify = app.getHttpAdapter().getInstance();
fastify.addHook("onSend", async (request, reply) => {
  void reply.header("x-correlation-id", request.id);
  void reply.header("x-content-type-options", "nosniff");
  void reply.header("cache-control", "no-store");
});

await app.listen(environment.PORT, "0.0.0.0");
