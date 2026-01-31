import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { QUEUE_NAMES } from '@/queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.IMPORT,
    }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
