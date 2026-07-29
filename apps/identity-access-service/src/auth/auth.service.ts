import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { UserStatus, type Prisma } from "@cdep/identity-prisma-client";
import { verify } from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { PrismaService } from "../prisma/prisma.service.js";
import { SigningKeyService } from "./signing-key.service.js";
import { getEnvironment } from "../environment.js";

type EffectiveIdentity = {
  userId: string;
  organizationId: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  identity: EffectiveIdentity;
};

const userAccessInclude = {
  memberships: {
    where: { status: "ACTIVE" },
    include: { organization: true },
    take: 1,
  },
  userRoles: {
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

@Injectable()
export class AuthService {
  private readonly environment = getEnvironment();

  constructor(
    private readonly prisma: PrismaService,
    private readonly signingKeys: SigningKeyService,
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: normalizedEmail },
      include: userAccessInclude,
    });

    if (!user?.passwordHash || !(await verify(user.passwordHash, password))) {
      if (user) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
        });
      }
      throw new UnauthorizedException("Invalid credentials.");
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException("The account is not active.");
    }

    const identity = this.toEffectiveIdentity(user);
    const refreshToken = this.createRefreshToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.environment.JWT_REFRESH_TTL_SECONDS * 1000,
    );
    const session = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.refreshTokenSession.create({
        data: {
          userId: user.id,
          familyId: randomUUID(),
          tokenHash: this.hashRefreshToken(refreshToken),
          expiresAt,
        },
      });
      await transaction.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: now,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: "User",
          aggregateId: user.id,
          eventType: "identity.authentication.succeeded",
          eventVersion: "1.0",
          correlationId: randomUUID(),
          payload: { userId: user.id, organizationId: identity.organizationId },
        },
      });
      return created;
    });

    return {
      accessToken: await this.issueAccessToken(identity, session.id),
      refreshToken,
      expiresIn: this.environment.JWT_ACCESS_TTL_SECONDS,
      identity,
    };
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const session = await this.prisma.refreshTokenSession.findFirst({
      where: {
        OR: [{ tokenHash }, { previousTokenHash: tokenHash }],
      },
      include: {
        user: { include: userAccessInclude },
      },
    });

    if (!session) {
      throw new UnauthorizedException("Invalid refresh token.");
    }
    if (session.previousTokenHash === tokenHash) {
      await this.prisma.refreshTokenSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: "REFRESH_TOKEN_REUSE",
        },
      });
      throw new UnauthorizedException("Refresh token reuse detected.");
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException(
        "Refresh session has expired or been revoked.",
      );
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException("The account is not active.");
    }

    const identity = this.toEffectiveIdentity(session.user);
    const nextRefreshToken = this.createRefreshToken();
    await this.prisma.refreshTokenSession.update({
      where: { id: session.id },
      data: {
        previousTokenHash: session.tokenHash,
        tokenHash: this.hashRefreshToken(nextRefreshToken),
        rotatedAt: new Date(),
      },
    });

    return {
      accessToken: await this.issueAccessToken(identity, session.id),
      refreshToken: nextRefreshToken,
      expiresIn: this.environment.JWT_ACCESS_TTL_SECONDS,
      identity,
    };
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.refreshTokenSession.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(rawToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revocationReason: "USER_LOGOUT",
      },
    });
  }

  async verifyAccessToken(token: string): Promise<EffectiveIdentity> {
    const { payload } = await jwtVerify(
      token,
      this.signingKeys.getPublicKey(),
      {
        algorithms: ["RS256"],
        issuer: this.environment.JWT_ISSUER,
        audience: this.environment.JWT_AUDIENCE,
      },
    );
    if (payload.token_type !== "access" || typeof payload.sub !== "string") {
      throw new UnauthorizedException("Invalid access token.");
    }
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const permissions = Array.isArray(payload.permissions)
      ? payload.permissions.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return {
      userId: payload.sub,
      organizationId: String(payload.org_id),
      displayName: "",
      email: "",
      roles,
      permissions,
    };
  }

  private toEffectiveIdentity(
    user: Prisma.UserGetPayload<{ include: typeof userAccessInclude }>,
  ): EffectiveIdentity {
    const membership = user.memberships[0];
    if (!membership) {
      throw new ForbiddenException("No active organization membership.");
    }
    const roles = [
      ...new Set(
        user.userRoles
          .filter(
            (assignment) =>
              assignment.organizationId === membership.organizationId,
          )
          .map((assignment) => assignment.role.name),
      ),
    ].sort();
    const permissions = [
      ...new Set(
        user.userRoles
          .filter(
            (assignment) =>
              assignment.organizationId === membership.organizationId,
          )
          .flatMap((assignment) =>
            assignment.role.rolePermissions.map(
              (entry) => entry.permission.code,
            ),
          ),
      ),
    ].sort();
    return {
      userId: user.id,
      organizationId: membership.organizationId,
      displayName: user.displayName,
      email: user.emailDisplay,
      roles,
      permissions,
    };
  }

  private async issueAccessToken(
    identity: EffectiveIdentity,
    sessionId: string,
  ): Promise<string> {
    return new SignJWT({
      org_id: identity.organizationId,
      roles: identity.roles,
      permissions: identity.permissions,
      session_id: sessionId,
      token_type: "access",
    })
      .setProtectedHeader({ alg: "RS256", kid: this.signingKeys.getKeyId() })
      .setSubject(identity.userId)
      .setIssuer(this.environment.JWT_ISSUER)
      .setAudience(this.environment.JWT_AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.environment.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.signingKeys.getPrivateKey());
  }

  private createRefreshToken(): string {
    return randomBytes(48).toString("base64url");
  }

  private hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
