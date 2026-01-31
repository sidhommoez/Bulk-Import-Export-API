import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES, ExportJobData } from '@/queue/queue.constants';
import { ExportsService } from '../exports.service';

@Processor(QUEUE_NAMES.EXPORT)
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(private readonly exportsService: ExportsService) {
    super();
  }

  async process(job: Job<ExportJobData>): Promise<void> {
    const jobName = job.name;

    if (jobName === JOB_NAMES.PROCESS_EXPORT) {
      await this.processExport(job);
    } else {
      this.logger.warn(`Unknown job name: ${jobName}`);
    }
  }

  private async processExport(job: Job<ExportJobData>): Promise<void> {
    this.logger.log(`Processing export job ${job.data.jobId}`);

    try {
      await this.exportsService.processExport(job.data);
    } catch (error) {
      this.logger.error(
        `Export job ${job.data.jobId} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<ExportJobData>): void {
    this.logger.log(`Job ${job.id} (${job.name}) started processing for export ${job.data.jobId}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ExportJobData>): void {
    this.logger.log(`Job ${job.id} (${job.name}) completed for export ${job.data.jobId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ExportJobData> | undefined, error: Error): void {
    if (job) {
      this.logger.error(
        `Job ${job.id} (${job.name}) failed for export ${job.data.jobId}: ${error.message}`,
        error.stack,
      );
    } else {
      this.logger.error(`Job failed: ${error.message}`, error.stack);
    }
  }
}
