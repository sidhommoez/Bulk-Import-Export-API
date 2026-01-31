import { validate, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export interface ValidationResult<T> {
  isValid: boolean;
  data?: T;
  errors?: FieldError[];
}

export interface FieldError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Validates an object against a DTO class
 */
export async function validateDto<T extends object>(
  dtoClass: new () => T,
  data: Record<string, unknown>,
): Promise<ValidationResult<T>> {
  const instance = plainToInstance(dtoClass, data, {
    enableImplicitConversion: true,
  });

  const validationErrors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: false,
    skipMissingProperties: false,
  });

  if (validationErrors.length > 0) {
    const errors = flattenValidationErrors(validationErrors);
    return { isValid: false, errors };
  }

  return { isValid: true, data: instance };
}

/**
 * Truncates a value for display in error messages
 */
export function truncateValue(value: unknown, maxLength = 100): unknown {
  if (typeof value === 'string' && value.length > maxLength) {
    return value.substring(0, maxLength) + '...';
  }
  return value;
}

/**
 * Flattens nested validation errors into a flat array of FieldError
 */
export function flattenValidationErrors(errors: ValidationError[], parentPath = ''): FieldError[] {
  const result: FieldError[] = [];

  for (const error of errors) {
    const fieldPath = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      const messages = Object.values(error.constraints);
      result.push({
        field: fieldPath,
        message: messages.join('; '),
        value: truncateValue(error.value),
      });
    }

    if (error.children && error.children.length > 0) {
      result.push(...flattenValidationErrors(error.children, fieldPath));
    }
  }

  return result;
}

/**
 * Validates email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates kebab-case slug format
 */
export function isValidSlug(slug: string): boolean {
  const kebabCaseRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return kebabCaseRegex.test(slug);
}

/**
 * Validates UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Counts words in a string
 */
export function countWords(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Validates body length (max 500 words for comments)
 */
export function isValidBodyLength(body: string, maxWords = 500): boolean {
  return countWords(body) <= maxWords;
}

/**
 * Converts a string to kebab-case
 */
export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Validates ISO 8601 date format
 */
export function isValidISODate(dateStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Parses boolean from various string representations
 */
export function parseBoolean(value: unknown): boolean | null {
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
  return null;
}

/**
 * Sanitizes a string by trimming and removing null bytes
 */
export function sanitizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return String(value);
  return value.trim().replace(/\0/g, '');
}

/**
 * Validates an array of tags
 */
export function isValidTagsArray(tags: unknown): tags is string[] {
  if (!Array.isArray(tags)) return false;
  return tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0);
}

/**
 * Normalizes tags array (trim, lowercase, dedupe)
 */
export function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  return [...new Set(normalized)].filter((tag) => tag.length > 0);
}
