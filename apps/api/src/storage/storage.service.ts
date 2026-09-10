import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Wraps S3/R2 access for short-lived presigned URLs. Per §9.4: private
// bucket, presigned URLs only (60-min expiry for reads), never public
// object URLs.
@Injectable()
export class StorageService {
  private client: S3Client | null = null;

  private getClient(): S3Client {
    if (this.client) return this.client;
    this.client = new S3Client({
      region: 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
    return this.client;
  }

  async getPresignedUrl(key: string, expirySeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key });
    return getSignedUrl(this.getClient(), command, { expiresIn: expirySeconds });
  }

  // PR 12 (§15.2 white-label branding pass) — direct-to-storage upload for
  // org logos. The client PUTs the file straight to S3/R2 with this URL,
  // our server never buffers the bytes, same shape as every other
  // presigned-URL flow in this codebase (§9.4). Short expiry (15 min
  // default) since this is only used for the immediate upload, not a
  // long-lived link like a rendered Short's playback URL.
  async getPresignedUploadUrl(key: string, contentType: string, expirySeconds = 900): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.getClient(), command, { expiresIn: expirySeconds });
  }
}
