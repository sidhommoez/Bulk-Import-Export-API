import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Parameter decorator to extract the Idempotency-Key header from the request.
 *
 * Usage:
 * ```typescript
 * @Post()
 * async createImport(@IdempotencyKey() idempotencyKey: string | undefined) {
 *   // idempotencyKey will be the value of the Idempotency-Key header, or undefined if not present
 * }
 * ```
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const idempotencyKey = request.headers[IDEMPOTENCY_KEY_HEADER];

    if (Array.isArray(idempotencyKey)) {
      return idempotencyKey[0];
    }

    return idempotencyKey;
  },
);

/**
 * Validates idempotency key format
 * Returns true if the key is valid (non-empty string, max 255 chars, alphanumeric with hyphens/underscores)
 */
export function isValidIdempotencyKey(key: string | undefined): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  if (key.length === 0 || key.length > 255) {
    return false;
  }

  // Allow alphanumeric characters, hyphens, underscores, and UUIDs
  const validPattern = /^[a-zA-Z0-9\-_]+$/;
  return validPattern.test(key);
}

/**
 * Generates a unique idempotency key
 */
export function generateIdempotencyKey(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomPart}`;
}
