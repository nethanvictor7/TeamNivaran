import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { loginRequestSchema, refreshRequestSchema } from "@cdep/contracts";
import { AuthService, type TokenPair } from "./auth.service.js";
import { SigningKeyService } from "./signing-key.service.js";
import { getEnvironment } from "../environment.js";

type CookieRequest = FastifyRequest & {
  cookies: Record<string, string | undefined>;
};
type CookieReply = FastifyReply & {
  clearCookie(name: string, options: { path: string }): FastifyReply;
  setCookie(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: "strict";
      path: string;
      maxAge: number;
    },
  ): FastifyReply;
};

@Controller("api/v1/auth")
export class AuthController {
  private readonly environment = getEnvironment();
  private readonly refreshCookieName = "cdep_refresh";

  constructor(
    private readonly authService: AuthService,
    private readonly signingKeys: SigningKeyService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<Omit<TokenPair, "refreshToken">> {
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Email and a password of at least 12 characters are required.",
      );
    }
    const pair = await this.authService.login(
      parsed.data.email,
      parsed.data.password,
    );
    this.writeRefreshCookie(reply, pair.refreshToken);
    return this.publicTokenPair(pair);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<Omit<TokenPair, "refreshToken">> {
    const parsed = refreshRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Invalid refresh request.");
    }
    const refreshToken =
      request.cookies[this.refreshCookieName] ?? parsed.data.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException("Refresh token is required.");
    }
    const pair = await this.authService.refresh(refreshToken);
    this.writeRefreshCookie(reply, pair.refreshToken);
    return this.publicTokenPair(pair);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<void> {
    const parsed = refreshRequestSchema.safeParse(body ?? {});
    const refreshToken =
      request.cookies[this.refreshCookieName] ??
      (parsed.success ? parsed.data.refreshToken : undefined);
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    reply.clearCookie(this.refreshCookieName, { path: "/api/v1/auth" });
  }

  @Get("jwks")
  getJwks(): ReturnType<SigningKeyService["getJwks"]> {
    return this.signingKeys.getJwks();
  }

  @Get("me")
  async me(@Req() request: FastifyRequest): Promise<{
    userId: string;
    organizationId: string;
    roles: string[];
    permissions: string[];
  }> {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException("Bearer access token is required.");
    }
    const identity = await this.authService.verifyAccessToken(token);
    return {
      userId: identity.userId,
      organizationId: identity.organizationId,
      roles: identity.roles,
      permissions: identity.permissions,
    };
  }

  private writeRefreshCookie(reply: CookieReply, refreshToken: string): void {
    reply.setCookie(this.refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: this.environment.REFRESH_COOKIE_SECURE,
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: this.environment.JWT_REFRESH_TTL_SECONDS,
    });
  }

  private publicTokenPair(pair: TokenPair): Omit<TokenPair, "refreshToken"> {
    const { refreshToken: _refreshToken, ...publicPair } = pair;
    return publicPair;
  }
}
