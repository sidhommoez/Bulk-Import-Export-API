import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@/queue/queue.constants';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: ComponentHealth;
    redis: ComponentHealth;
  };
}

interface ComponentHealth {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectQueue(QUEUE_NAMES.IMPORT)
    private readonly importQueue: Queue,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check endpoint',
    description: 'Returns the health status of the application and its dependencies.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Application is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
        uptime: { type: 'number', example: 3600 },
        version: { type: 'string', example: '1.0.0' },
        checks: {
          type: 'object',
          properties: {
            database: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'up' },
                latencyMs: { type: 'number', example: 5 },
              },
            },
            redis: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'up' },
                latencyMs: { type: 'number', example: 2 },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Application is unhealthy',
  })
  async getHealth(): Promise<HealthStatus> {
    const [databaseHealth, redisHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const isHealthy = databaseHealth.status === 'up' && redisHealth.status === 'up';

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        database: databaseHealth,
        redis: redisHealth,
      },
    };
  }

  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Simple liveness check for Kubernetes.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Application is alive',
  })
  getLiveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Checks if the application is ready to accept traffic.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Application is ready',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Application is not ready',
  })
  async getReadiness(): Promise<{ status: string; ready: boolean }> {
    const [dbReady, redisReady] = await Promise.all([
      this.checkDatabase().then((h) => h.status === 'up'),
      this.checkRedis().then((h) => h.status === 'up'),
    ]);

    const ready = dbReady && redisReady;

    return {
      status: ready ? 'ok' : 'not ready',
      ready,
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'up',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      // BullMQ uses ioredis under the hood
      const client = await this.importQueue.client;
      await client.ping();
      return {
        status: 'up',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
