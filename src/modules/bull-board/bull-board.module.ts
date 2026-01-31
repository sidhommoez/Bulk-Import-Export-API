import { Module } from '@nestjs/common';
import { BullBoardModule as BullBoardNestModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@/queue/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.IMPORT }, { name: QUEUE_NAMES.EXPORT }),
    BullBoardNestModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: QUEUE_NAMES.IMPORT,
      adapter: BullMQAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: QUEUE_NAMES.EXPORT,
      adapter: BullMQAdapter,
    }),
  ],
})
export class BullBoardModule {}
