import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { getEnvironment } from "./environment.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Injectable()
export class IdentityInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const suppliedHeader = context.switchToHttp().getRequest().headers[
      "x-cdep-internal-service-token"
    ];
    const supplied = Buffer.from(
      typeof suppliedHeader === "string" ? suppliedHeader : "",
    );
    const expected = Buffer.from(getEnvironment().INTERNAL_SERVICE_TOKEN);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new UnauthorizedException(
        "Internal service authentication failed.",
      );
    return true;
  }
}

@Controller("internal/v1/identity")
@UseGuards(IdentityInternalGuard)
export class IdentityInternalController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("eligibility")
  async eligibility(@Body() body: Record<string, unknown>) {
    if (
      typeof body.organizationId !== "string" ||
      typeof body.userId !== "string" ||
      typeof body.requiredPermission !== "string"
    )
      throw new BadRequestException("Invalid eligibility request.");
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId: body.organizationId,
        userId: body.userId,
        status: "ACTIVE",
        organization: { active: true },
        user: { status: "ACTIVE" },
      },
      include: {
        user: {
          include: {
            userRoles: {
              where: { organizationId: body.organizationId },
              include: {
                role: {
                  include: {
                    rolePermissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!membership) throw new NotFoundException("Eligible user not found.");
    const permissions = new Set(
      membership.user.userRoles.flatMap((assignment) =>
        assignment.role.rolePermissions.map(
          (rolePermission) => rolePermission.permission.code,
        ),
      ),
    );
    const roles = membership.user.userRoles.map(
      (assignment) => assignment.role.name,
    );
    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      active: true,
      eligible: permissions.has(body.requiredPermission),
      permissions: [...permissions].sort(),
      roles: roles.sort(),
    };
  }
}
