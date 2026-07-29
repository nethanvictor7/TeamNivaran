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

export type AiIdentity = {
  userId: string;
  organizationId: string;
  roles: string[];
  permissions: string[];
};
export type AuthenticatedRequest = FastifyRequest & {
  identity: AiIdentity;
  id: string;
};
const PERMISSION = "cdep-required-permission";
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
    const split = (value: string | string[] | undefined) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
    request.identity = {
      userId,
      organizationId,
      roles: split(request.headers["x-user-roles"]),
      permissions: split(request.headers["x-user-permissions"]),
    };
    const required = this.reflector.getAllAndOverride<string>(PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !request.identity.permissions.includes(required))
      throw new ForbiddenException(`Permission '${required}' is required.`);
    return true;
  }
}
