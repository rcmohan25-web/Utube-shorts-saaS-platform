import { Injectable } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Wraps S3/R2 access for short-lived presigned GET URLs. Per §9.4: private
// bucket, presigned URLs only (60-min expiry), never public object URLs.
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
}
