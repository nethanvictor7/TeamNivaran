import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { accessTokenClaimsSchema } from "@cdep/contracts";
import { getEnvironment } from "./environment.js";

export type AuthenticatedRequest = FastifyRequest & {
  identity: { userId: string; organizationId: string; permissions: string[] };
};
export const Permission = (permission: string) =>
  SetMetadata("permission", permission);

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly env = getEnvironment();
  private readonly jwks = createRemoteJWKSet(new URL(this.env.JWT_JWKS_URL));
  constructor(private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.headers.authorization;
    if (!raw?.startsWith("Bearer "))
      throw new UnauthorizedException("Bearer access token is required.");
    try {
      const verified = await jwtVerify(raw.slice(7), this.jwks, {
        algorithms: ["RS256"],
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
      });
      const claims = accessTokenClaimsSchema.parse(verified.payload);
      request.identity = {
        userId: claims.sub,
        organizationId: claims.org_id,
        permissions: claims.permissions,
      };
    } catch {
      throw new UnauthorizedException(
        "The access token is invalid or expired.",
      );
    }
    const permission = this.reflector.getAllAndOverride<string>("permission", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permission && !request.identity.permissions.includes(permission)) {
      throw new ForbiddenException(`Permission ${permission} is required.`);
    }
    return true;
  }
}
