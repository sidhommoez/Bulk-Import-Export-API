import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ImportJob, ImportJobStatus } from '@/database/entities/import-job.entity';
import { ExportJob, ExportJobStatus } from '@/database/entities/export-job.entity';
import { DistributedLockService } from './distributed-lock.service';

export interface StaleJobCleanupOptions {
  /** How long a job can be in PROCESSING state before being considered stale (ms) */
  staleThresholdMs?: number;
  /** How long a job can be locked before the lock is considered stale (ms) */
  staleLockThresholdMs?: number;
  /** Whether to automatically restart stale jobs or just mark them as failed */
  restartStaleJobs?: boolean;
}

const DEFAULT_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_STALE_LOCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class StaleJobCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaleJobCleanupService.name);
  private readonly staleThresholdMs: number;
  private readonly staleLockThresholdMs: number;
  private readonly restartStaleJobs: boolean;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(ImportJob)
    private readonly importJobRepository: Repository<ImportJob>,
    @InjectRepository(ExportJob)
    private readonly exportJobRepository: Repository<ExportJob>,
    private readonly distributedLockService: DistributedLockService,
    private readonly configService: ConfigService,
  ) {
    this.staleThresholdMs = this.configService.get<number>(
      'job.staleThresholdMs',
      DEFAULT_STALE_THRESHOLD_MS,
    );
    this.staleLockThresholdMs = this.configService.get<number>(
      'job.staleLockThresholdMs',
      DEFAULT_STALE_LOCK_THRESHOLD_MS,
    );
    this.restartStaleJobs = this.configService.get<boolean>('job.restartStaleJobs', false);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `Stale job cleanup service initialized (staleThreshold: ${this.staleThresholdMs}ms, staleLockThreshold: ${this.staleLockThresholdMs}ms)`,
    );

    // Run initial cleanup after a short delay to allow other services to initialize
    setTimeout(() => {
      this.cleanupStaleJobs().catch((err) => {
        this.logger.error(`Initial stale job cleanup failed: ${err.message}`);
      });
    }, 5000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.logger.log('Stale job cleanup service shut down');
  }

  /**
   * Scheduled cleanup of stale jobs - runs every 5 minutes
   * Uses @nestjs/schedule Cron decorator
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledCleanup(): Promise<void> {
    await this.cleanupStaleJobs();
  }

  /**
   * Clean up stale import and export jobs
   */
  async cleanupStaleJobs(): Promise<{ imports: number; exports: number }> {
    // Use distributed lock to ensure only one node runs cleanup at a time
    const lock = await this.distributedLockService.acquireLock('stale-job-cleanup', {
      ttlMs: 60000, // 1 minute
      retries: 0,
    });

    if (!lock) {
      this.logger.debug('Stale job cleanup already running on another node, skipping');
      return { imports: 0, exports: 0 };
    }

    try {
      const [importCount, exportCount] = await Promise.all([
        this.cleanupStaleImportJobs(),
        this.cleanupStaleExportJobs(),
      ]);

      if (importCount > 0 || exportCount > 0) {
        this.logger.log(`Cleaned up stale jobs: ${importCount} imports, ${exportCount} exports`);
      }

      return { imports: importCount, exports: exportCount };
    } finally {
      await this.distributedLockService.releaseLock(lock);
    }
  }

  /**
   * Clean up stale import jobs
   */
  private async cleanupStaleImportJobs(): Promise<number> {
    const staleThreshold = new Date(Date.now() - this.staleThresholdMs);
    const staleLockThreshold = new Date(Date.now() - this.staleLockThresholdMs);

    // Find jobs that are stuck in PROCESSING state
    const staleProcessingJobs = await this.importJobRepository.find({
      where: {
        status: ImportJobStatus.PROCESSING,
        startedAt: LessThan(staleThreshold),
      },
    });

    // Find jobs with stale locks (locked but lock is old)
    const staleLockJobs = await this.importJobRepository
      .createQueryBuilder('job')
      .where('job.lockedBy IS NOT NULL')
      .andWhere('job.lockedAt < :threshold', { threshold: staleLockThreshold })
      .andWhere('job.status IN (:...statuses)', {
        statuses: [ImportJobStatus.PENDING, ImportJobStatus.PROCESSING],
      })
      .getMany();

    const allStaleJobs = this.deduplicateJobs([...staleProcessingJobs, ...staleLockJobs]);
    let cleanedCount = 0;

    for (const job of allStaleJobs) {
      try {
        await this.handleStaleImportJob(job);
        cleanedCount++;
      } catch (error) {
        this.logger.error(
          `Failed to clean up stale import job ${job.id}: ${(error as Error).message}`,
        );
      }
    }

    return cleanedCount;
  }

  /**
   * Clean up stale export jobs
   */
  private async cleanupStaleExportJobs(): Promise<number> {
    const staleThreshold = new Date(Date.now() - this.staleThresholdMs);
    const staleLockThreshold = new Date(Date.now() - this.staleLockThresholdMs);

    // Find jobs that are stuck in PROCESSING state
    const staleProcessingJobs = await this.exportJobRepository.find({
      where: {
        status: ExportJobStatus.PROCESSING,
        startedAt: LessThan(staleThreshold),
      },
    });

    // Find jobs with stale locks
    const staleLockJobs = await this.exportJobRepository
      .createQueryBuilder('job')
      .where('job.lockedBy IS NOT NULL')
      .andWhere('job.lockedAt < :threshold', { threshold: staleLockThreshold })
      .andWhere('job.status IN (:...statuses)', {
        statuses: [ExportJobStatus.PENDING, ExportJobStatus.PROCESSING],
      })
      .getMany();

    const allStaleJobs = this.deduplicateJobs([...staleProcessingJobs, ...staleLockJobs]);
    let cleanedCount = 0;

    for (const job of allStaleJobs) {
      try {
        await this.handleStaleExportJob(job);
        cleanedCount++;
      } catch (error) {
        this.logger.error(
          `Failed to clean up stale export job ${job.id}: ${(error as Error).message}`,
        );
      }
    }

    return cleanedCount;
  }

  /**
   * Handle a stale import job
   */
  private async handleStaleImportJob(job: ImportJob): Promise<void> {
    this.logger.warn(
      `Found stale import job ${job.id} (status: ${job.status}, lockedBy: ${job.lockedBy}, startedAt: ${job.startedAt})`,
    );

    if (this.restartStaleJobs && job.status === ImportJobStatus.PROCESSING) {
      // Reset to PENDING so it can be retried
      await this.importJobRepository.update(job.id, {
        status: ImportJobStatus.PENDING,
        lockedBy: null,
        lockedAt: null,
        startedAt: null,
        errorMessage: `Job was reset after being stale for over ${this.staleThresholdMs / 1000}s`,
      });
      this.logger.log(`Reset stale import job ${job.id} to PENDING for retry`);
    } else {
      // Mark as FAILED
      await this.importJobRepository.update(job.id, {
        status: ImportJobStatus.FAILED,
        lockedBy: null,
        lockedAt: null,
        completedAt: new Date(),
        errorMessage: `Job failed due to stale processing (possibly crashed node). Started at: ${job.startedAt}, Locked by: ${job.lockedBy}`,
      });
      this.logger.log(`Marked stale import job ${job.id} as FAILED`);
    }

    // Also release any Redis lock that might still be held
    await this.releaseOrphanedLock(`import-job:${job.id}`);
  }

  /**
   * Handle a stale export job
   */
  private async handleStaleExportJob(job: ExportJob): Promise<void> {
    this.logger.warn(
      `Found stale export job ${job.id} (status: ${job.status}, lockedBy: ${job.lockedBy}, startedAt: ${job.startedAt})`,
    );

    if (this.restartStaleJobs && job.status === ExportJobStatus.PROCESSING) {
      // Reset to PENDING so it can be retried
      await this.exportJobRepository.update(job.id, {
        status: ExportJobStatus.PENDING,
        lockedBy: null,
        lockedAt: null,
        startedAt: null,
        errorMessage: `Job was reset after being stale for over ${this.staleThresholdMs / 1000}s`,
      });
      this.logger.log(`Reset stale export job ${job.id} to PENDING for retry`);
    } else {
      // Mark as FAILED
      await this.exportJobRepository.update(job.id, {
        status: ExportJobStatus.FAILED,
        lockedBy: null,
        lockedAt: null,
        completedAt: new Date(),
        errorMessage: `Job failed due to stale processing (possibly crashed node). Started at: ${job.startedAt}, Locked by: ${job.lockedBy}`,
      });
      this.logger.log(`Marked stale export job ${job.id} as FAILED`);
    }

    // Also release any Redis lock that might still be held
    await this.releaseOrphanedLock(`export-job:${job.id}`);
  }

  /**
   * Attempt to release an orphaned Redis lock
   */
  private async releaseOrphanedLock(resourceKey: string): Promise<void> {
    const isLocked = await this.distributedLockService.isLocked(resourceKey);
    if (isLocked) {
      const holder = await this.distributedLockService.getLockHolder(resourceKey);
      this.logger.warn(`Found orphaned lock for ${resourceKey} held by ${holder}`);
      // Note: We can't force-release the lock without the token
      // The lock will expire naturally based on its TTL
    }
  }

  /**
   * Deduplicate jobs by ID
   */
  private deduplicateJobs<T extends { id: string }>(jobs: T[]): T[] {
    const seen = new Set<string>();
    return jobs.filter((job) => {
      if (seen.has(job.id)) {
        return false;
      }
      seen.add(job.id);
      return true;
    });
  }

  /**
   * Manually trigger cleanup for a specific job (useful for admin operations)
   */
  async forceCleanupImportJob(jobId: string): Promise<boolean> {
    const job = await this.importJobRepository.findOne({ where: { id: jobId } });
    if (!job) {
      return false;
    }

    if (job.status === ImportJobStatus.PROCESSING || job.lockedBy) {
      await this.handleStaleImportJob(job);
      return true;
    }

    return false;
  }

  /**
   * Manually trigger cleanup for a specific export job
   */
  async forceCleanupExportJob(jobId: string): Promise<boolean> {
    const job = await this.exportJobRepository.findOne({ where: { id: jobId } });
    if (!job) {
      return false;
    }

    if (job.status === ExportJobStatus.PROCESSING || job.lockedBy) {
      await this.handleStaleExportJob(job);
      return true;
    }

    return false;
  }

  /**
   * Get statistics about potentially stale jobs
   */
  async getStaleJobStats(): Promise<{
    imports: { processing: number; lockedStale: number };
    exports: { processing: number; lockedStale: number };
  }> {
    const staleThreshold = new Date(Date.now() - this.staleThresholdMs);
    const staleLockThreshold = new Date(Date.now() - this.staleLockThresholdMs);

    const [importProcessing, importLocked, exportProcessing, exportLocked] = await Promise.all([
      this.importJobRepository.count({
        where: {
          status: ImportJobStatus.PROCESSING,
          startedAt: LessThan(staleThreshold),
        },
      }),
      this.importJobRepository
        .createQueryBuilder('job')
        .where('job.lockedBy IS NOT NULL')
        .andWhere('job.lockedAt < :threshold', { threshold: staleLockThreshold })
        .getCount(),
      this.exportJobRepository.count({
        where: {
          status: ExportJobStatus.PROCESSING,
          startedAt: LessThan(staleThreshold),
        },
      }),
      this.exportJobRepository
        .createQueryBuilder('job')
        .where('job.lockedBy IS NOT NULL')
        .andWhere('job.lockedAt < :threshold', { threshold: staleLockThreshold })
        .getCount(),
    ]);

    return {
      imports: { processing: importProcessing, lockedStale: importLocked },
      exports: { processing: exportProcessing, lockedStale: exportLocked },
    };
  }
}
