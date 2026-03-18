import { Client } from 'minio';
import { config } from './config.js';

export const minioClient = new Client({
  endPoint: config.minio.endPoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey
});

export async function initBucket() {
  const exists = await minioClient.bucketExists(config.minio.bucket).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(config.minio.bucket, 'us-east-1');
  }
}
