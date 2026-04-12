import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

let cachedClient: { client: S3Client; bucket: string } | null = null;

function getS3() {
  if (cachedClient) return cachedClient;

  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "auto";
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing S3 configuration. Set S3_ENDPOINT, S3_BUCKET, " +
        "S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY environment variables.",
    );
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  cachedClient = { client, bucket };
  return cachedClient;
}

/**
 * Generate a presigned PUT URL for direct browser upload.
 */
export async function createPresignedUploadUrl(options: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<{ url: string; key: string }> {
  const { client, bucket } = getS3();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    ContentType: options.contentType,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: options.expiresInSeconds ?? 3600,
  });

  return { url, key: options.key };
}

/**
 * Generate a presigned GET URL for file download.
 */
export async function createPresignedDownloadUrl(options: {
  key: string;
  filename?: string;
  expiresInSeconds?: number;
}): Promise<{ url: string; expiresAt: number }> {
  const { client, bucket } = getS3();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: options.key,
    ...(options.filename && {
      ResponseContentDisposition: `attachment; filename="${options.filename}"`,
    }),
  });

  const expiresIn = options.expiresInSeconds ?? 3600;
  const url = await getSignedUrl(client, command, { expiresIn });
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return { url, expiresAt };
}

/**
 * Delete a file from S3.
 */
export async function deleteFile(key: string): Promise<void> {
  const { client, bucket } = getS3();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await client.send(command);
}
