import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DistributedLockService } from './services/distributed-lock.service';
import { StaleJobCleanupService } from './services/stale-job-cleanup.service';
import { ImportJob } from '@/database/entities/import-job.entity';
import { ExportJob } from '@/database/entities/export-job.entity';

@Global()
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([ImportJob, ExportJob]),
  ],
  providers: [DistributedLockService, StaleJobCleanupService],
  exports: [DistributedLockService, StaleJobCleanupService],
})
export class CommonModule {}
