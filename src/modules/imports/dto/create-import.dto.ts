import { IsString, IsOptional, IsUrl, IsEnum, IsNotEmpty, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResourceType } from '@/database/entities';

export class CreateImportDto {
  @ApiProperty({
    description: 'The type of resource to import',
    enum: ResourceType,
    example: ResourceType.USERS,
  })
  @IsEnum(ResourceType)
  @IsNotEmpty()
  resourceType: ResourceType;

  @ApiPropertyOptional({
    description: 'URL of the remote file to import (mutually exclusive with file upload)',
    example: 'https://example.com/data/users.ndjson',
  })
  @ValidateIf((o) => !o.file && !o.filePath)
  @IsUrl({}, { message: 'fileUrl must be a valid URL' })
  @IsOptional()
  fileUrl?: string;

  @ApiPropertyOptional({
    description: 'File format (json, ndjson, csv). Auto-detected if not provided.',
    enum: ['json', 'ndjson', 'csv'],
    example: 'ndjson',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['json', 'ndjson', 'csv'], { message: 'format must be one of: json, ndjson, csv' })
  format?: 'json' | 'ndjson' | 'csv';
}

export class CreateImportFromFileDto {
  @ApiProperty({
    description: 'The type of resource to import',
    enum: ResourceType,
    example: ResourceType.USERS,
  })
  @IsEnum(ResourceType)
  @IsNotEmpty()
  resourceType: ResourceType;

  @ApiPropertyOptional({
    description:
      'File format (json, ndjson, csv). Auto-detected from file extension if not provided.',
    enum: ['json', 'ndjson', 'csv'],
    example: 'ndjson',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['json', 'ndjson', 'csv'], { message: 'format must be one of: json, ndjson, csv' })
  format?: 'json' | 'ndjson' | 'csv';
}

export class ImportJobResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the import job',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'The type of resource being imported',
    enum: ResourceType,
  })
  resourceType: ResourceType;

  @ApiProperty({
    description: 'Current status of the import job',
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    example: 'pending',
  })
  status: string;

  @ApiPropertyOptional({
    description: 'Idempotency key if provided',
  })
  idempotencyKey?: string;

  @ApiProperty({
    description: 'Total number of rows in the file',
    example: 10000,
  })
  totalRows: number;

  @ApiProperty({
    description: 'Number of rows processed so far',
    example: 5000,
  })
  processedRows: number;

  @ApiProperty({
    description: 'Number of rows successfully imported',
    example: 4900,
  })
  successfulRows: number;

  @ApiProperty({
    description: 'Number of rows that failed validation',
    example: 100,
  })
  failedRows: number;

  @ApiProperty({
    description: 'Number of rows skipped (e.g., duplicates)',
    example: 0,
  })
  skippedRows: number;

  @ApiPropertyOptional({
    description: 'Progress percentage (0-100)',
    example: 50,
  })
  progressPercentage?: number;

  @ApiPropertyOptional({
    description: 'File name of the imported file',
  })
  fileName?: string;

  @ApiPropertyOptional({
    description: 'File size in bytes',
  })
  fileSize?: number;

  @ApiPropertyOptional({
    description: 'File format',
  })
  fileFormat?: string;

  @ApiPropertyOptional({
    description: 'Array of validation errors (limited to first 100)',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        row: { type: 'number' },
        field: { type: 'string' },
        message: { type: 'string' },
        value: { type: 'any' },
      },
    },
  })
  errors?: Array<{
    row: number;
    field?: string;
    message: string;
    value?: unknown;
  }>;

  @ApiPropertyOptional({
    description: 'Job metrics',
    type: 'object',
    properties: {
      rowsPerSecond: { type: 'number' },
      errorRate: { type: 'number' },
      durationMs: { type: 'number' },
    },
  })
  metrics?: {
    rowsPerSecond: number;
    errorRate: number;
    durationMs: number;
  };

  @ApiPropertyOptional({
    description: 'Error message if the job failed',
  })
  errorMessage?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the job started processing',
  })
  startedAt?: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the job completed',
  })
  completedAt?: Date;

  @ApiProperty({
    description: 'Timestamp when the job was created',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the job was last updated',
  })
  updatedAt: Date;
}

export class ImportErrorDto {
  @ApiProperty({
    description: 'Row number where the error occurred',
    example: 42,
  })
  row: number;

  @ApiPropertyOptional({
    description: 'Field name that caused the error',
    example: 'email',
  })
  field?: string;

  @ApiProperty({
    description: 'Error message',
    example: 'Invalid email format',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'The invalid value',
    example: 'not-an-email',
  })
  value?: unknown;
}
