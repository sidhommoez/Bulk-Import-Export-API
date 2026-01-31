import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportProcessor } from './processors/export.processor';
import { ExportJob, User, Article, Comment } from '@/database/entities';
import { StorageModule } from '@/storage/storage.module';
import { QUEUE_NAMES } from '@/queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExportJob, User, Article, Comment]),
    BullModule.registerQueue({
      name: QUEUE_NAMES.EXPORT,
    }),
    ConfigModule,
    StorageModule,
  ],
  controllers: [ExportsController],
  providers: [ExportsService, ExportProcessor],
  exports: [ExportsService],
})
export class ExportsModule {}
