import {
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  IsArray,
  IsObject,
  IsBoolean,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ResourceType } from '@/database/entities';

export enum ExportFormat {
  JSON = 'json',
  NDJSON = 'ndjson',
  CSV = 'csv',
}

export class ExportFiltersDto {
  @ApiPropertyOptional({
    description: 'Filter by specific IDs',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Filter records created after this date',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @ApiPropertyOptional({
    description: 'Filter records created before this date',
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  createdBefore?: string;

  @ApiPropertyOptional({
    description: 'Filter records updated after this date',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  updatedAfter?: string;

  @ApiPropertyOptional({
    description: 'Filter records updated before this date',
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  updatedBefore?: string;

  @ApiPropertyOptional({
    description: 'Filter articles by status',
    enum: ['draft', 'published', 'archived'],
    example: 'published',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter users by active status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Filter articles by author ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  authorId?: string;

  @ApiPropertyOptional({
    description: 'Filter comments by article ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  articleId?: string;

  @ApiPropertyOptional({
    description: 'Filter comments by user ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class CreateExportDto {
  @ApiProperty({
    description: 'The type of resource to export',
    enum: ResourceType,
    example: ResourceType.ARTICLES,
  })
  @IsEnum(ResourceType)
  @IsNotEmpty()
  resourceType: ResourceType;

  @ApiPropertyOptional({
    description: 'Export format',
    enum: ExportFormat,
    default: ExportFormat.NDJSON,
    example: 'ndjson',
  })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;

  @ApiPropertyOptional({
    description: 'Filters to apply to the export',
    type: ExportFiltersDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ExportFiltersDto)
  filters?: ExportFiltersDto;

  @ApiPropertyOptional({
    description: 'Specific fields to include in the export (if omitted, all fields are included)',
    type: [String],
    example: ['id', 'email', 'name'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];
}

export class StreamingExportQueryDto {
  @ApiProperty({
    description: 'The type of resource to export',
    enum: ResourceType,
    example: 'articles',
  })
  @IsEnum(ResourceType)
  @IsNotEmpty()
  resource: ResourceType;

  @ApiPropertyOptional({
    description: 'Export format',
    enum: ExportFormat,
    default: ExportFormat.NDJSON,
    example: 'ndjson',
  })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;
}

export class ExportJobResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the export job',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'The type of resource being exported',
    enum: ResourceType,
  })
  resourceType: ResourceType;

  @ApiProperty({
    description: 'Export format',
    enum: ExportFormat,
  })
  format: ExportFormat;

  @ApiProperty({
    description: 'Current status of the export job',
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    example: 'pending',
  })
  status: string;

  @ApiPropertyOptional({
    description: 'Filters applied to the export',
    type: ExportFiltersDto,
  })
  filters?: ExportFiltersDto;

  @ApiPropertyOptional({
    description: 'Fields included in the export',
    type: [String],
  })
  fields?: string[];

  @ApiPropertyOptional({
    description: 'URL to download the exported file (available when completed)',
    example: 'https://bucket.s3.amazonaws.com/exports/2024-01-15/abc123/export.ndjson?...',
  })
  downloadUrl?: string;

  @ApiPropertyOptional({
    description: 'Name of the exported file',
  })
  fileName?: string;

  @ApiPropertyOptional({
    description: 'Size of the exported file in bytes',
  })
  fileSize?: number;

  @ApiProperty({
    description: 'Total number of rows to export',
    example: 10000,
  })
  totalRows: number;

  @ApiProperty({
    description: 'Number of rows exported so far',
    example: 5000,
  })
  exportedRows: number;

  @ApiPropertyOptional({
    description: 'Progress percentage (0-100)',
    example: 50,
  })
  progressPercentage?: number;

  @ApiPropertyOptional({
    description: 'Export metrics',
    type: 'object',
    properties: {
      rowsPerSecond: { type: 'number' },
      totalBytes: { type: 'number' },
      durationMs: { type: 'number' },
    },
  })
  metrics?: {
    rowsPerSecond: number;
    totalBytes: number;
    durationMs: number;
  };

  @ApiPropertyOptional({
    description: 'Error message if the job failed',
  })
  errorMessage?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the download URL expires',
  })
  expiresAt?: Date;

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
