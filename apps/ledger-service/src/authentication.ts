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

export type LedgerIdentity = {
  userId: string;
  organizationId: string;
  permissions: string[];
};

export type AuthenticatedRequest = FastifyRequest & {
  identity: LedgerIdentity;
  id: string;
};

const PERMISSION = "cdep-ledger-permission";
export const Permission = (permission: string) =>
  SetMetadata(PERMISSION, permission);

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.headers["x-user-id"];
    const organizationId = request.headers["x-organization-id"];
    if (typeof userId !== "string" || typeof organizationId !== "string")
      throw new UnauthorizedException("Authenticated identity is required.");
    const permissions =
      typeof request.headers["x-user-permissions"] === "string"
        ? request.headers["x-user-permissions"]
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
    request.identity = { userId, organizationId, permissions };
    const required = this.reflector.getAllAndOverride<string>(PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !permissions.includes(required))
      throw new ForbiddenException(`Permission '${required}' is required.`);
    return true;
  }
}
