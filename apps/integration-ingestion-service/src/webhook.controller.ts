import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { IntegrationService } from "./integration.service.js";

type WebhookRequest = {
  id: string;
  body: unknown;
  rawBody?: Buffer;
};

@Controller("api/v1/integration/hooks")
export class WebhookController {
  private readonly windows = new Map<
    string,
    { startedAt: number; count: number }
  >();
  constructor(private readonly service: IntegrationService) {}

  @Post(":connectorKey")
  @HttpCode(202)
  async receive(
    @Param("connectorKey") connectorKey: string,
    @Headers("x-cdep-webhook-key") suppliedKey: string | undefined,
    @Headers("x-source-event-id") sourceRecordId: string | undefined,
    @Req() request: WebhookRequest,
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(connectorKey))
      throw new UnauthorizedException("Webhook authentication failed.");
    const context = await this.service.publicWebhookContext(connectorKey);
    if (!suppliedKey)
      throw new UnauthorizedException("Webhook authentication failed.");
    const expected = Buffer.from(context.secret),
      supplied = Buffer.from(suppliedKey);
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new UnauthorizedException("Webhook authentication failed.");
    this.enforceRateLimit(
      connectorKey,
      Number(
        (context.connector.configurationJson as any).rateLimitPerMinute ?? 60,
      ),
    );
    if (!request.rawBody)
      throw new BadRequestException("Raw request body is unavailable.");
    return this.service.acceptWebhook(
      context,
      sourceRecordId,
      request.rawBody,
      request.body,
      request.id,
    );
  }

  private enforceRateLimit(key: string, maximum: number) {
    const now = Date.now(),
      current = this.windows.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maximum)
      throw new HttpException(
        "Webhook rate limit exceeded.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}
