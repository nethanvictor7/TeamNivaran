import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { accessTokenClaimsSchema } from "@cdep/contracts";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getEnvironment } from "./environment.js";

export type WorkflowIdentity = {
  userId: string;
  organizationId: string;
  permissions: string[];
  roles: string[];
};

export type AuthenticatedRequest = FastifyRequest & {
  identity: WorkflowIdentity;
};

export const Permission = (permission: string) =>
  SetMetadata("permission", permission);

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly environment = getEnvironment();
  private readonly jwks = createRemoteJWKSet(
    new URL(this.environment.JWT_JWKS_URL),
    {
      cooldownDuration: 30_000,
      cacheMaxAge: 300_000,
      timeoutDuration: 2_000,
    },
  );
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : undefined;
    if (!token) throw new UnauthorizedException("A bearer token is required.");
    try {
      const verified = await jwtVerify(token, this.jwks, {
        algorithms: ["RS256"],
        issuer: this.environment.JWT_ISSUER,
        audience: this.environment.JWT_AUDIENCE,
      });
      const claims = accessTokenClaimsSchema.parse(verified.payload);
      request.identity = {
        userId: claims.sub,
        organizationId: claims.org_id,
        permissions: claims.permissions,
        roles: claims.roles,
      };
    } catch {
      throw new UnauthorizedException(
        "The bearer token is invalid or expired.",
      );
    }
    const permission = this.reflector.getAllAndOverride<string>("permission", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permission && !request.identity.permissions.includes(permission))
      throw new ForbiddenException(`Permission ${permission} is required.`);
    return true;
  }
}
