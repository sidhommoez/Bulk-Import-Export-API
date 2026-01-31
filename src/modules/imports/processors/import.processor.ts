import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES, ImportJobData } from '@/queue/queue.constants';
import { ImportsService } from '../imports.service';

@Processor(QUEUE_NAMES.IMPORT)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly importsService: ImportsService) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    const jobName = job.name;

    if (jobName === JOB_NAMES.PROCESS_IMPORT) {
      await this.processImport(job);
    } else {
      this.logger.warn(`Unknown job name: ${jobName}`);
    }
  }

  private async processImport(job: Job<ImportJobData>): Promise<void> {
    this.logger.log(`Processing import job ${job.data.jobId}`);

    try {
      await this.importsService.processImport(job.data);
    } catch (error) {
      this.logger.error(
        `Import job ${job.data.jobId} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<ImportJobData>): void {
    this.logger.log(`Job ${job.id} (${job.name}) started processing for import ${job.data.jobId}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ImportJobData>): void {
    this.logger.log(`Job ${job.id} (${job.name}) completed for import ${job.data.jobId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ImportJobData> | undefined, error: Error): void {
    if (job) {
      this.logger.error(
        `Job ${job.id} (${job.name}) failed for import ${job.data.jobId}: ${error.message}`,
        error.stack,
      );
    } else {
      this.logger.error(`Job failed: ${error.message}`, error.stack);
    }
  }
}
