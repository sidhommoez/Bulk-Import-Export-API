import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  IsBoolean,
  IsUUID,
  IsArray,
  IsDateString,
  MaxLength,
  MinLength,
  Matches,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '@/database/entities/user.entity';
import { ArticleStatus } from '@/database/entities/article.entity';

/**
 * DTO for validating user import records
 */
export class ImportUserRecordDto {
  @IsOptional()
  @IsUUID('4', { message: 'id must be a valid UUID v4' })
  id?: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @IsString()
  @MinLength(1, { message: 'name cannot be empty' })
  @MaxLength(255)
  @Transform(({ value }) => value?.trim())
  name: string;

  @IsEnum(UserRole, {
    message: `role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  @Transform(({ value }) => value?.toLowerCase().trim())
  role: UserRole;

  @IsBoolean({ message: 'active must be a boolean value' })
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      if (['true', '1', 'yes'].includes(lower)) return true;
      if (['false', '0', 'no'].includes(lower)) return false;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    return value;
  })
  active: boolean;

  @IsOptional()
  @IsDateString({}, { message: 'created_at must be a valid ISO 8601 date string' })
  created_at?: string;

  @IsOptional()
  @IsDateString({}, { message: 'updated_at must be a valid ISO 8601 date string' })
  updated_at?: string;
}

/**
 * DTO for validating article import records
 */
export class ImportArticleRecordDto {
  @IsOptional()
  @IsUUID('4', { message: 'id must be a valid UUID v4' })
  id?: string;

  @IsString()
  @MinLength(1, { message: 'slug cannot be empty' })
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be in kebab-case format (e.g., my-article-title)',
  })
  @Transform(({ value }) => value?.toLowerCase().trim())
  slug: string;

  @IsString()
  @MinLength(1, { message: 'title cannot be empty' })
  @MaxLength(500)
  @Transform(({ value }) => value?.trim())
  title: string;

  @IsString()
  @MinLength(1, { message: 'body cannot be empty' })
  body: string;

  @IsUUID('4', { message: 'author_id must be a valid UUID v4' })
  author_id: string;

  @IsOptional()
  @IsArray({ message: 'tags must be an array' })
  @IsString({ each: true, message: 'each tag must be a string' })
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value.map((tag: string) => tag?.trim().toLowerCase()).filter(Boolean);
    }
    return value;
  })
  tags?: string[];

  @IsEnum(ArticleStatus, {
    message: `status must be one of: ${Object.values(ArticleStatus).join(', ')}`,
  })
  @Transform(({ value }) => value?.toLowerCase().trim())
  status: ArticleStatus;

  @ValidateIf((o) => o.status === ArticleStatus.PUBLISHED || o.published_at !== undefined)
  @IsOptional()
  @IsDateString({}, { message: 'published_at must be a valid ISO 8601 date string' })
  published_at?: string;

  @IsOptional()
  @IsDateString({}, { message: 'created_at must be a valid ISO 8601 date string' })
  created_at?: string;

  @IsOptional()
  @IsDateString({}, { message: 'updated_at must be a valid ISO 8601 date string' })
  updated_at?: string;
}

/**
 * DTO for validating comment import records
 */
export class ImportCommentRecordDto {
  @IsOptional()
  @IsString()
  @Matches(/^(cm_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'id must be a valid UUID v4 (with optional cm_ prefix)',
  })
  id?: string;

  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'article_id must be a valid UUID',
  })
  article_id: string;

  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'user_id must be a valid UUID',
  })
  user_id: string;

  @IsNotEmpty({ message: 'body is required' })
  @IsString({ message: 'body must be a string' })
  @MaxLength(10000, { message: 'body cannot exceed 10000 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body: string;

  @IsOptional()
  @IsDateString({}, { message: 'created_at must be a valid ISO 8601 date string' })
  created_at?: string;
}

/**
 * Union type for all import record types
 */
export type ImportRecordDto = ImportUserRecordDto | ImportArticleRecordDto | ImportCommentRecordDto;

/**
 * Mapping of resource types to their DTO classes
 */
export const IMPORT_RECORD_DTO_MAP = {
  users: ImportUserRecordDto,
  articles: ImportArticleRecordDto,
  comments: ImportCommentRecordDto,
} as const;

/**
 * Interface for validated import record result
 */
export interface ValidatedImportRecord<T = unknown> {
  isValid: boolean;
  data?: T;
  errors?: Array<{
    field: string;
    message: string;
    value?: unknown;
  }>;
  lineNumber: number;
  raw?: unknown;
}

/**
 * Interface for import batch result
 */
export interface ImportBatchResult {
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{
    row: number;
    field?: string;
    message: string;
    value?: unknown;
  }>;
}
