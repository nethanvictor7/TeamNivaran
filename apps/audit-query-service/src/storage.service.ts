import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { getEnvironment } from "./environment.js";

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

@Injectable()
export class ArtifactStorage implements OnModuleInit {
  private readonly environment = getEnvironment();
  private readonly client = this.createClient(
    this.environment.OBJECT_STORAGE_ENDPOINT,
  );
  private readonly publicClient = this.createClient(
    this.environment.OBJECT_STORAGE_PUBLIC_ENDPOINT ??
      this.environment.OBJECT_STORAGE_ENDPOINT,
  );

  private createClient(endpoint: string) {
    return new S3Client({
      endpoint,
      region: this.environment.OBJECT_STORAGE_REGION,
      forcePathStyle: this.environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: this.environment.OBJECT_STORAGE_ACCESS_KEY,
        secretAccessKey: this.environment.OBJECT_STORAGE_SECRET_KEY,
      },
    });
  }

  async onModuleInit() {
    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: this.environment.OBJECT_STORAGE_AUDIT_BUCKET,
        }),
      );
    } catch {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: this.environment.OBJECT_STORAGE_AUDIT_BUCKET,
        }),
      );
    }
  }

  async ready() {
    await this.client.send(
      new HeadBucketCommand({
        Bucket: this.environment.OBJECT_STORAGE_AUDIT_BUCKET,
      }),
    );
  }

  async put(input: {
    key: string;
    body: Buffer;
    mediaType: string;
    checksumSha256: string;
  }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.environment.OBJECT_STORAGE_AUDIT_BUCKET,
        Key: input.key,
        Body: input.body,
        ContentType: input.mediaType,
        Metadata: { sha256: input.checksumSha256 },
      }),
    );
    return {
      bucket: this.environment.OBJECT_STORAGE_AUDIT_BUCKET,
      key: input.key,
    };
  }

  async grant(input: { key: string; filename: string }) {
    const expiresIn = this.environment.DOWNLOAD_GRANT_SECONDS;
    const url = await getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.environment.OBJECT_STORAGE_AUDIT_BUCKET,
        Key: input.key,
        ResponseCacheControl: "no-store",
        ResponseContentDisposition: `attachment; filename="${safeFilename(input.filename)}"`,
      }),
      { expiresIn },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }
}
