import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'v1',
  apiKey: process.env.API_KEY || '',
}));

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'bulk_import_export',
  synchronize: process.env.DATABASE_SYNCHRONIZE === 'true',
  logging: process.env.DATABASE_LOGGING === 'true',
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
}));

export const awsConfig = registerAs('aws', () => ({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  s3: {
    bucket: process.env.AWS_S3_BUCKET || 'bulk-import-export',
    endpoint: process.env.AWS_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  },
}));

export const jobConfig = registerAs('job', () => ({
  batchSize: parseInt(process.env.JOB_BATCH_SIZE || '1000', 10),
  concurrency: parseInt(process.env.JOB_CONCURRENCY || '2', 10),
  maxRetries: parseInt(process.env.JOB_MAX_RETRIES || '3', 10),
  retryDelay: parseInt(process.env.JOB_RETRY_DELAY || '5000', 10),
}));

export const exportConfig = registerAs('export', () => ({
  rowsPerSecondTarget: parseInt(process.env.EXPORT_ROWS_PER_SECOND_TARGET || '5000', 10),
  streamHighWaterMark: parseInt(process.env.EXPORT_STREAM_HIGHWATERMARK || '16384', 10),
}));

export const importConfig = registerAs('import', () => ({
  maxFileSizeMB: parseInt(process.env.IMPORT_MAX_FILE_SIZE_MB || '500', 10),
  allowedExtensions: (process.env.IMPORT_ALLOWED_EXTENSIONS || 'json,ndjson,csv').split(','),
}));

export const logConfig = registerAs('log', () => ({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.LOG_FORMAT || 'json',
}));

export const rateLimitConfig = registerAs('rateLimit', () => ({
  ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
}));

export const corsConfig = registerAs('cors', () => ({
  origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
}));

export const swaggerConfig = registerAs('swagger', () => ({
  enabled:
    process.env.SWAGGER_ENABLED !== undefined
      ? process.env.SWAGGER_ENABLED === 'true'
      : process.env.NODE_ENV !== 'production',
}));

export default () => ({
  app: appConfig(),
  database: databaseConfig(),
  redis: redisConfig(),
  aws: awsConfig(),
  job: jobConfig(),
  export: exportConfig(),
  import: importConfig(),
  log: logConfig(),
  rateLimit: rateLimitConfig(),
  cors: corsConfig(),
  swagger: swaggerConfig(),
});
