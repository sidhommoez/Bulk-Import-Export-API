import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import configuration, {
  appConfig,
  databaseConfig,
  redisConfig,
  awsConfig,
  jobConfig,
  exportConfig,
  importConfig,
  logConfig,
} from './config/configuration';
import { dataSourceOptions } from './database/data-source';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CommonModule } from './common/common.module';

import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ExportsModule } from './modules/exports/exports.module';
import { HealthModule } from './modules/health/health.module';
import { BullBoardModule } from './modules/bull-board/bull-board.module';

@Module({
  imports: [
    // Common services (distributed locking, etc.)
    CommonModule,

    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        configuration,
        appConfig,
        databaseConfig,
        redisConfig,
        awsConfig,
        jobConfig,
        exportConfig,
        importConfig,
        logConfig,
      ],
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => ({
        ...dataSourceOptions,
        autoLoadEntities: true,
      }),
    }),

    // Queue (Bull with Redis)
    QueueModule,

    // Storage (S3/LocalStack)
    StorageModule,

    // Feature modules
    ImportsModule,
    ExportsModule,
    HealthModule,
    BullBoardModule,
  ],
  providers: [
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
