import { plainToClass } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'v1';

  // Database
  @IsString()
  DATABASE_HOST: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  DATABASE_PORT: number;

  @IsString()
  DATABASE_USERNAME: string;

  @IsString()
  DATABASE_PASSWORD: string;

  @IsString()
  DATABASE_NAME: string;

  @IsString()
  @IsOptional()
  DATABASE_SYNCHRONIZE: string = 'false';

  @IsString()
  @IsOptional()
  DATABASE_LOGGING: string = 'false';

  // Redis
  @IsString()
  REDIS_HOST: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  // AWS S3
  @IsString()
  @IsOptional()
  AWS_REGION: string = 'us-east-1';

  @IsString()
  AWS_ACCESS_KEY_ID: string;

  @IsString()
  AWS_SECRET_ACCESS_KEY: string;

  @IsString()
  AWS_S3_BUCKET: string;

  @IsString()
  @IsOptional()
  AWS_S3_ENDPOINT?: string;

  @IsString()
  @IsOptional()
  AWS_S3_FORCE_PATH_STYLE: string = 'false';

  // Job Processing
  @IsNumber()
  @Min(100)
  @Max(10000)
  @IsOptional()
  JOB_BATCH_SIZE: number = 1000;

  @IsNumber()
  @Min(1)
  @Max(10)
  @IsOptional()
  JOB_CONCURRENCY: number = 2;

  @IsNumber()
  @Min(0)
  @Max(10)
  @IsOptional()
  JOB_MAX_RETRIES: number = 3;

  @IsNumber()
  @Min(1000)
  @IsOptional()
  JOB_RETRY_DELAY: number = 5000;

  // Export Settings
  @IsNumber()
  @Min(1000)
  @IsOptional()
  EXPORT_ROWS_PER_SECOND_TARGET: number = 5000;

  @IsNumber()
  @Min(1024)
  @IsOptional()
  EXPORT_STREAM_HIGHWATERMARK: number = 16384;

  // Import Settings
  @IsNumber()
  @Min(1)
  @Max(5000)
  @IsOptional()
  IMPORT_MAX_FILE_SIZE_MB: number = 500;

  @IsString()
  @IsOptional()
  IMPORT_ALLOWED_EXTENSIONS: string = 'json,ndjson,csv';

  // Logging
  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsOptional()
  LOG_FORMAT: string = 'json';

  // Rate Limiting
  @IsNumber()
  @Min(1)
  @IsOptional()
  RATE_LIMIT_TTL: number = 60;

  @IsNumber()
  @Min(1)
  @IsOptional()
  RATE_LIMIT_MAX: number = 100;

  // CORS
  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:3000';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map((error) => {
      const constraints = error.constraints;
      if (constraints) {
        return Object.values(constraints).join(', ');
      }
      return `${error.property} has invalid value`;
    });

    throw new Error(`Configuration validation failed:\n${errorMessages.join('\n')}`);
  }

  return validatedConfig;
}
