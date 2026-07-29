import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { accessTokenClaimsSchema } from "@cdep/contracts";
import { env } from "./environment.js";
export type RequestIdentity = {
  identity: { userId: string; organizationId: string; permissions: string[] };
  headers: any;
  id: string;
  url: string;
};
export const Permission = (p: string) => SetMetadata("permission", p);
@Injectable()
export class AuthGuard implements CanActivate {
  private e = env();
  private jwks = createRemoteJWKSet(new URL(this.e.JWT_JWKS_URL));
  constructor(private reflector: Reflector) {}
  async canActivate(c: ExecutionContext) {
    const r = c.switchToHttp().getRequest<RequestIdentity>(),
      h = r.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new UnauthorizedException();
    try {
      const v = await jwtVerify(h.slice(7), this.jwks, {
          algorithms: ["RS256"],
          issuer: this.e.JWT_ISSUER,
          audience: this.e.JWT_AUDIENCE,
        }),
        x = accessTokenClaimsSchema.parse(v.payload);
      r.identity = {
        userId: x.sub,
        organizationId: x.org_id,
        permissions: x.permissions,
      };
    } catch {
      throw new UnauthorizedException("Invalid access token.");
    }
    const p = this.reflector.getAllAndOverride<string>("permission", [
      c.getHandler(),
      c.getClass(),
    ]);
    if (p && !r.identity.permissions.includes(p))
      throw new ForbiddenException(`Permission ${p} is required.`);
    return true;
  }
}
