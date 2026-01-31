import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportProcessor } from './processors/import.processor';
import { ImportJob, User, Article, Comment } from '@/database/entities';
import { StorageModule } from '@/storage/storage.module';
import { QUEUE_NAMES } from '@/queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJob, User, Article, Comment]),
    BullModule.registerQueue({
      name: QUEUE_NAMES.IMPORT,
    }),
    ConfigModule,
    StorageModule,
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max file size
      },
    }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportProcessor],
  exports: [ImportsService],
})
export class ImportsModule {}
