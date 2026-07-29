import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  type JWK,
} from "jose";
import { getEnvironment } from "../environment.js";

@Injectable()
export class SigningKeyService implements OnModuleInit {
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  private publicJwk!: JWK;
  private readonly environment = getEnvironment();

  async onModuleInit(): Promise<void> {
    const privateKeyBase64 = this.environment.JWT_PRIVATE_KEY_BASE64;
    const publicKeyBase64 = this.environment.JWT_PUBLIC_KEY_BASE64;

    if (privateKeyBase64 && publicKeyBase64) {
      this.privateKey = await importPKCS8(
        Buffer.from(privateKeyBase64, "base64").toString("utf8"),
        "RS256",
      );
      this.publicKey = await importSPKI(
        Buffer.from(publicKeyBase64, "base64").toString("utf8"),
        "RS256",
      );
    } else if (this.environment.JWT_ALLOW_EPHEMERAL_KEYS) {
      const keyPair = await generateKeyPair("RS256", {
        extractable: true,
        modulusLength: 2048,
      });
      this.privateKey = keyPair.privateKey;
      this.publicKey = keyPair.publicKey;
    } else {
      throw new Error(
        "JWT signing keys are missing and ephemeral keys are disabled.",
      );
    }

    this.publicJwk = await exportJWK(this.publicKey);
    this.publicJwk.alg = "RS256";
    this.publicJwk.use = "sig";
    this.publicJwk.kid = this.environment.JWT_KEY_ID;
  }

  getPrivateKey(): CryptoKey {
    return this.privateKey;
  }

  getPublicKey(): CryptoKey {
    return this.publicKey;
  }

  getKeyId(): string {
    return this.environment.JWT_KEY_ID;
  }

  getJwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }
}
