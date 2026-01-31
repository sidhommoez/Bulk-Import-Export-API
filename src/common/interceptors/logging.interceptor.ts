import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface RequestLogContext {
  requestId: string;
  method: string;
  path: string;
  query: Record<string, unknown>;
  userAgent?: string;
  ip?: string;
  contentLength?: number;
}

export interface ResponseLogContext extends RequestLogContext {
  statusCode: number;
  durationMs: number;
  contentLength?: number;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Generate or extract request ID
    const requestId = (request.headers['x-request-id'] as string) || uuidv4();
    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-Id', requestId);

    const startTime = Date.now();

    const requestContext: RequestLogContext = {
      requestId,
      method: request.method,
      path: request.url,
      query: request.query as Record<string, unknown>,
      userAgent: request.headers['user-agent'],
      ip: request.ip || request.headers['x-forwarded-for'] as string,
      contentLength: request.headers['content-length']
        ? parseInt(request.headers['content-length'], 10)
        : undefined,
    };

    // Log incoming request
    this.logger.log({
      message: `Incoming ${request.method} ${request.url}`,
      ...requestContext,
      type: 'request',
    });

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - startTime;
        const responseContext: ResponseLogContext = {
          ...requestContext,
          statusCode: response.statusCode,
          durationMs,
          contentLength: response.getHeader('content-length') as number | undefined,
        };

        // Log successful response
        this.logger.log({
          message: `${request.method} ${request.url} ${response.statusCode} - ${durationMs}ms`,
          ...responseContext,
          type: 'response',
        });
      }),
      catchError((error) => {
        const durationMs = Date.now() - startTime;
        const statusCode = error.status || error.statusCode || 500;

        // Log error response
        this.logger.error({
          message: `${request.method} ${request.url} ${statusCode} - ${durationMs}ms`,
          ...requestContext,
          statusCode,
          durationMs,
          error: {
            name: error.name,
            message: error.message,
          },
          type: 'error',
        });

        throw error;
      }),
    );
  }
}

/**
 * Formats duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(2);
  return `${minutes}m ${seconds}s`;
}

/**
 * Formats bytes in human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
