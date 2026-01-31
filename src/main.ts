import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // Get configuration
  const port = configService.get<number>('app.port', 3000);
  const nodeEnv = configService.get<string>('app.nodeEnv', 'development');

  // Security middleware
  app.use(helmet());

  // CORS
  const corsOrigins = configService.get<string[]>('cors.origins', ['http://localhost:3000']);
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: true,
  });

  // Global prefix - use v1 as the API prefix, exclude admin and docs routes
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'admin/queues', method: RequestMethod.ALL },
      { path: 'admin/queues/(.*)', method: RequestMethod.ALL },
      { path: 'api/docs', method: RequestMethod.ALL },
      { path: 'api/docs/(.*)', method: RequestMethod.ALL },
    ],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: nodeEnv === 'production',
    }),
  );

  // Swagger documentation (controlled by environment variable, defaults to enabled in non-production)
  const swaggerEnabled = configService.get<boolean>('swagger.enabled', nodeEnv !== 'production');
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Bulk Import/Export API')
      .setDescription(
        `
## Overview
This API provides endpoints for bulk data import and export operations.

## Features
- **Import**: Upload files (JSON, NDJSON, CSV) or provide remote URLs for bulk data import
- **Export**: Stream data directly or create background export jobs
- **Async Processing**: Long-running operations are processed in the background
- **Idempotency**: Use the Idempotency-Key header to prevent duplicate imports

## Resources
- **Users**: id, email, name, role, active, created_at, updated_at
- **Articles**: id, slug, title, body, author_id, tags, published_at, status
- **Comments**: id, article_id, user_id, body, created_at

## Validation Rules
- Users: valid and unique email; allowed roles (admin, manager, author, editor, reader); boolean active
- Articles: author_id must reference any valid user; slug unique and kebab-case; draft must not have published_at
- Comments: article_id must reference a valid article; user_id must reference any valid user; body length <= 500 words and 10000 characters
        `.trim(),
      )
      .setVersion('1.0')
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API key for authentication. Set API_KEY environment variable to enable.',
        },
        'api-key',
      )
      .addTag('Imports', 'Bulk data import operations')
      .addTag('Exports', 'Bulk data export operations')
      .addTag('Health', 'Health check endpoints')
      .addServer(`http://localhost:${port}`, 'Local Development')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });

    logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  // Start server
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`API endpoint: http://localhost:${port}/v1`);
  logger.log(`Environment: ${nodeEnv}`);
}

const bootstrapLogger = new Logger('Bootstrap');
bootstrap().catch((error) => {
  bootstrapLogger.error('Failed to start application:', error);
  process.exit(1);
});
