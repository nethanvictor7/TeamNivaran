import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { SigningKeyService } from "./auth/signing-key.service.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma/prisma.service.js";
import {
  IdentityInternalController,
  IdentityInternalGuard,
} from "./internal.controller.js";

@Module({
  controllers: [AuthController, IdentityInternalController, HealthController],
  providers: [
    AuthService,
    SigningKeyService,
    PrismaService,
    IdentityInternalGuard,
  ],
})
export class AppModule {}
