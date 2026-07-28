import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "./environment.js";
@Injectable()
export class SecretProtector {
  private e = env();
  private key = Buffer.from(
    this.e.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY,
    "base64url",
  );
  constructor() {
    if (this.e.CONNECTOR_SECRET_PROVIDER === "local" && this.key.length !== 32)
      throw new Error("Credential encryption key must be 32 bytes.");
  }
  encrypt(value: string) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, nonce),
      ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
    return {
      provider: "local",
      algorithm: "AES-256-GCM",
      keyId: this.e.CONNECTOR_CREDENTIAL_KEY_ID,
      nonce,
      authTag: cipher.getAuthTag(),
      ciphertext,
    };
  }
  reference(secretRef: string) {
    if (!/^file:\/run\/secrets\/[A-Za-z0-9._-]+$/.test(secretRef))
      throw new Error(
        "External secret references must use file:/run/secrets/<name>.",
      );
    return { provider: "external", secretRef };
  }
  decrypt(x: {
    provider?: string;
    secretRef?: string | null;
    nonce: Uint8Array | null;
    authTag: Uint8Array | null;
    ciphertext: Uint8Array | null;
  }) {
    if (x.provider === "external") {
      if (
        !x.secretRef ||
        !/^file:\/run\/secrets\/[A-Za-z0-9._-]+$/.test(x.secretRef)
      )
        throw new Error("External credential reference is invalid.");
      return readFileSync(x.secretRef.slice(5), "utf8").trim();
    }
    if (!x.nonce || !x.authTag || !x.ciphertext)
      throw new Error("Credential material is unavailable.");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(x.nonce));
    d.setAuthTag(Buffer.from(x.authTag));
    return Buffer.concat([
      d.update(Buffer.from(x.ciphertext)),
      d.final(),
    ]).toString("utf8");
  }
}
