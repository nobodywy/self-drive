import dotenv from 'dotenv';

dotenv.config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: required('JWT_SECRET'),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 100),
  postgres: {
    host: required('POSTGRES_HOST', 'localhost'),
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: required('POSTGRES_DB'),
    user: required('POSTGRES_USER'),
    password: required('POSTGRES_PASSWORD')
  },
  minio: {
    endPoint: required('MINIO_ENDPOINT', 'localhost'),
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: String(process.env.MINIO_USE_SSL || 'false') === 'true',
    accessKey: required('MINIO_ROOT_USER'),
    secretKey: required('MINIO_ROOT_PASSWORD'),
    bucket: required('MINIO_BUCKET', 'self-drive')
  }
};
