import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { Transform, type Readable } from "node:stream";
import { getEnvironment } from "./environment.js";

export interface EvidenceObjectStorage {
  putQuarantineObject(input: {
    key: string;
    body: NodeJS.ReadableStream;
    contentType?: string;
    expectedMaxBytes: number;
  }): Promise<{
    bucket: string;
    key: string;
    providerVersionId?: string;
    sizeBytes: number;
  }>;
  getObjectStream(input: {
    bucket: string;
    key: string;
  }): Promise<NodeJS.ReadableStream>;
  headObject(input: { bucket: string; key: string }): Promise<{
    sizeBytes: number;
    contentType?: string;
    providerVersionId?: string;
  }>;
  promoteToCanonical(input: {
    quarantineBucket: string;
    quarantineKey: string;
    canonicalKey: string;
  }): Promise<{
    bucket: string;
    key: string;
    providerVersionId?: string;
  }>;
  createDownloadGrant(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    downloadFilename: string;
  }): Promise<{ url: string; expiresAt: string }>;
  deleteQuarantineObject(input: { bucket: string; key: string }): Promise<void>;
}

export class ByteLimitTransform extends Transform {
  sizeBytes = 0;
  constructor(private readonly maximum: number) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    this.sizeBytes += chunk.length;
    if (this.sizeBytes > this.maximum) {
      callback(new Error("UPLOAD_SIZE_LIMIT_EXCEEDED"));
      return;
    }
    callback(null, chunk);
  }
}

function safeContentDisposition(filename: string) {
  const safe = filename
    .replace(/[\u0000-\u001f\u007f"\\/\r\n]/g, "_")
    .slice(0, 180);
  return `attachment; filename="${safe || "evidence"}"`;
}

@Injectable()
export class S3EvidenceObjectStorage implements EvidenceObjectStorage {
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

  async ready() {
    await Promise.all([
      this.client.send(
        new HeadBucketCommand({
          Bucket: this.environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
        }),
      ),
      this.client.send(
        new HeadBucketCommand({
          Bucket: this.environment.OBJECT_STORAGE_EVIDENCE_BUCKET,
        }),
      ),
    ]);
  }

  async putQuarantineObject(input: {
    key: string;
    body: NodeJS.ReadableStream;
    contentType?: string;
    expectedMaxBytes: number;
  }) {
    const limiter = new ByteLimitTransform(input.expectedMaxBytes);
    const body = (input.body as Readable).pipe(limiter);
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
        Key: input.key,
        Body: body,
        ContentType: input.contentType ?? "application/octet-stream",
      },
      queueSize: 1,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    });
    const result = await upload.done();
    return {
      bucket: this.environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
      key: input.key,
      ...(result.VersionId ? { providerVersionId: result.VersionId } : {}),
      sizeBytes: limiter.sizeBytes,
    };
  }

  async getObjectStream(input: { bucket: string; key: string }) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
    if (!response.Body) throw new Error("OBJECT_NOT_FOUND");
    return response.Body as NodeJS.ReadableStream;
  }

  async headObject(input: { bucket: string; key: string }) {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
    return {
      sizeBytes: response.ContentLength ?? 0,
      ...(response.ContentType ? { contentType: response.ContentType } : {}),
      ...(response.VersionId ? { providerVersionId: response.VersionId } : {}),
    };
  }

  async promoteToCanonical(input: {
    quarantineBucket: string;
    quarantineKey: string;
    canonicalKey: string;
  }) {
    const response = await this.client.send(
      new CopyObjectCommand({
        Bucket: this.environment.OBJECT_STORAGE_EVIDENCE_BUCKET,
        Key: input.canonicalKey,
        CopySource: `${encodeURIComponent(input.quarantineBucket)}/${input.quarantineKey
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        MetadataDirective: "COPY",
      }),
    );
    return {
      bucket: this.environment.OBJECT_STORAGE_EVIDENCE_BUCKET,
      key: input.canonicalKey,
      ...(response.VersionId ? { providerVersionId: response.VersionId } : {}),
    };
  }

  async createDownloadGrant(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    downloadFilename: string;
  }) {
    const url = await getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ResponseContentDisposition: safeContentDisposition(
          input.downloadFilename,
        ),
        ResponseCacheControl: "no-store",
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return {
      url,
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
    };
  }

  async deleteQuarantineObject(input: { bucket: string; key: string }) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
  }
}

export async function bootstrapBuckets() {
  const environment = getEnvironment();
  const client = new S3Client({
    endpoint: environment.OBJECT_STORAGE_ENDPOINT,
    region: environment.OBJECT_STORAGE_REGION,
    forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: environment.OBJECT_STORAGE_SECRET_KEY,
    },
  });
  for (const bucket of new Set([
    environment.OBJECT_STORAGE_QUARANTINE_BUCKET,
    environment.OBJECT_STORAGE_EVIDENCE_BUCKET,
  ])) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
  client.destroy();
}
