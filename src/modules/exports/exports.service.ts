import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, ObjectLiteral, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Readable, PassThrough } from 'stream';

import {
  ExportJob,
  ExportJobStatus,
  ExportFormat,
  ResourceType,
  User,
  Article,
  Comment,
} from '@/database/entities';
import { StorageService } from '@/storage/storage.service';
import { QUEUE_NAMES, JOB_NAMES, ExportJobData } from '@/queue/queue.constants';
import {
  CreateExportDto,
  ExportJobResponseDto,
  ExportFiltersDto,
  ExportFormat as ExportFormatEnum,
} from './dto/create-export.dto';
import {
  NdjsonStringifyTransform,
  MetricsTransform,
  ByteCountTransform,
} from '@/common/utils/stream.utils';
import { DistributedLockService } from '@/common/services/distributed-lock.service';

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);
  private readonly batchSize: number;
  private readonly downloadUrlExpiryHours = 24;

  constructor(
    @InjectRepository(ExportJob)
    private readonly exportJobRepository: Repository<ExportJob>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Article)
    private readonly articleRepository: Repository<Article>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectQueue(QUEUE_NAMES.EXPORT)
    private readonly exportQueue: Queue,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly distributedLockService: DistributedLockService,
  ) {
    this.batchSize = this.configService.get<number>('job.batchSize', 1000);
  }

  /**
   * Creates an async export job
   */
  async createExport(dto: CreateExportDto): Promise<ExportJobResponseDto> {
    const format = dto.format || ExportFormatEnum.NDJSON;

    // Create job record
    const job = this.exportJobRepository.create({
      resourceType: dto.resourceType,
      format: format as unknown as ExportFormat,
      status: ExportJobStatus.PENDING,
      filters: dto.filters ? { ...dto.filters } : null,
      fields: dto.fields || null,
      totalRows: 0,
      exportedRows: 0,
    });

    await this.exportJobRepository.save(job);

    // Queue the export job
    await this.exportQueue.add(
      JOB_NAMES.PROCESS_EXPORT,
      {
        jobId: job.id,
        resourceType: dto.resourceType,
        format,
        filters: dto.filters,
        fields: dto.fields,
      } as ExportJobData,
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(`Created export job ${job.id} for ${dto.resourceType}`);
    return this.toResponseDto(job);
  }

  /**
   * Gets an export job by ID
   */
  async getJob(jobId: string): Promise<ExportJobResponseDto> {
    const job = await this.exportJobRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Export job ${jobId} not found`);
    }

    // If completed and download URL is about to expire, generate a new one
    if (job.status === ExportJobStatus.COMPLETED && job.fileName) {
      const expiryThreshold = new Date();
      expiryThreshold.setHours(expiryThreshold.getHours() + 1);

      if (!job.expiresAt || job.expiresAt < expiryThreshold) {
        const downloadUrl = await this.storageService.getPresignedDownloadUrl(job.fileName, {
          expiresIn: this.downloadUrlExpiryHours * 3600,
        });

        job.downloadUrl = downloadUrl;
        job.expiresAt = new Date(Date.now() + this.downloadUrlExpiryHours * 3600 * 1000);
        await this.exportJobRepository.save(job);
      }
    }

    return this.toResponseDto(job);
  }

  /**
   * Creates a streaming export (direct response)
   */
  async createStreamingExport(
    resourceType: ResourceType,
    format: ExportFormatEnum,
  ): Promise<{ stream: Readable; contentType: string; fileName: string }> {
    const contentType = this.getContentType(format);
    const fileName = `export-${resourceType}-${Date.now()}.${format}`;

    const stream = await this.createExportStream(resourceType, format, null, null);

    return { stream, contentType, fileName };
  }

  /**
   * Processes an export job (called by the queue processor)
   */
  /**
   * Processes an export job (called by the queue processor)
   * Uses distributed locking to ensure only one node processes a job at a time
   */
  async processExport(jobData: ExportJobData): Promise<void> {
    const lockKey = `export-job:${jobData.jobId}`;
    const nodeId = this.distributedLockService.getNodeId();

    // Acquire distributed lock to prevent multiple nodes from processing the same job
    const lock = await this.distributedLockService.acquireLock(lockKey, {
      ttlMs: 300000, // 5 minutes, will be renewed automatically
      retries: 0, // Don't retry - if locked, another node is processing
    });

    if (!lock) {
      this.logger.warn(`Job ${jobData.jobId} is already being processed by another node, skipping`);
      return;
    }

    try {
      // Atomic status transition: PENDING -> PROCESSING
      const transitionResult = await this.atomicStatusTransition(
        jobData.jobId,
        ExportJobStatus.PENDING,
        ExportJobStatus.PROCESSING,
        { lockedBy: nodeId, lockedAt: new Date(), startedAt: new Date() },
      );

      if (!transitionResult.success) {
        this.logger.warn(
          `Job ${jobData.jobId} status transition failed: ${transitionResult.reason}`,
        );
        return;
      }

      const job = transitionResult.job!;
      await this.executeExportProcessing(job, jobData);
    } finally {
      // Always release the distributed lock
      await this.distributedLockService.releaseLock(lock);
    }
  }

  /**
   * Atomically transition job status with optimistic locking
   */
  private async atomicStatusTransition(
    jobId: string,
    fromStatus: ExportJobStatus,
    toStatus: ExportJobStatus,
    additionalUpdates?: Partial<ExportJob>,
  ): Promise<{ success: boolean; job?: ExportJob; reason?: string }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      // Lock the row for update to prevent concurrent modifications
      const job = await queryRunner.manager
        .getRepository(ExportJob)
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :id', { id: jobId })
        .getOne();

      if (!job) {
        await queryRunner.rollbackTransaction();
        return { success: false, reason: 'Job not found' };
      }

      if (job.status !== fromStatus) {
        await queryRunner.rollbackTransaction();
        return {
          success: false,
          reason: `Job status is ${job.status}, expected ${fromStatus}`,
        };
      }

      // Update status and any additional fields
      job.status = toStatus;
      if (additionalUpdates) {
        Object.assign(job, additionalUpdates);
      }

      await queryRunner.manager.save(job);
      await queryRunner.commitTransaction();

      return { success: true, job };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Atomic status transition failed: ${message}`);
      return { success: false, reason: message };
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Execute the actual export processing logic
   */
  private async executeExportProcessing(job: ExportJob, jobData: ExportJobData): Promise<void> {
    const startTime = Date.now();

    try {
      // Count total rows
      const totalRows = await this.countRecords(job.resourceType, job.filters);
      job.totalRows = totalRows;
      await this.exportJobRepository.save(job);

      // Generate export file key
      const fileKey = this.storageService.generateExportKey(job.id, jobData.format);
      const format = jobData.format as unknown as ExportFormatEnum;

      // Create export stream
      const exportStream = await this.createExportStream(
        job.resourceType,
        format,
        job.filters,
        job.fields,
      );

      // Create byte counter
      const byteCounter = new ByteCountTransform();

      // Create metrics tracker
      const metricsTransform = new MetricsTransform({
        logIntervalMs: 5000,
        onMetrics: async (metrics) => {
          if (!metrics.final) {
            // Update progress periodically
            await this.exportJobRepository.update(job.id, {
              exportedRows: metrics.totalRows,
            });
          }
        },
      });

      // Pipe through transforms
      const pipeline = exportStream.pipe(metricsTransform).pipe(byteCounter);

      // Upload to S3
      const { size } = await this.storageService.uploadStream(fileKey, pipeline, {
        contentType: this.getContentType(format),
        metadata: {
          jobId: job.id,
          resourceType: job.resourceType,
          format: jobData.format,
        },
      });

      // Calculate metrics
      const durationMs = Date.now() - startTime;
      const rowsPerSecond = durationMs > 0 ? Math.round((totalRows / durationMs) * 1000) : 0;

      // Generate download URL
      const downloadUrl = await this.storageService.getPresignedDownloadUrl(fileKey, {
        expiresIn: this.downloadUrlExpiryHours * 3600,
      });

      const fileSize = size || byteCounter.getBytes();

      // Atomic transition to COMPLETED with final metrics
      await this.finalizeJob(job.id, ExportJobStatus.COMPLETED, {
        exportedRows: totalRows,
        fileName: fileKey,
        fileSize,
        downloadUrl,
        expiresAt: new Date(Date.now() + this.downloadUrlExpiryHours * 3600 * 1000),
        completedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        metrics: {
          rowsPerSecond,
          totalBytes: fileSize,
          durationMs,
        },
      });

      this.logger.log(
        `Completed export job ${job.id}: ${totalRows} rows, ${fileSize} bytes, ${rowsPerSecond} rows/sec`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Export job ${job.id} failed: ${errorMessage}`);

      // Atomic transition to FAILED
      await this.finalizeJob(job.id, ExportJobStatus.FAILED, {
        errorMessage,
        completedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        metrics: {
          rowsPerSecond: 0,
          totalBytes: 0,
          durationMs: Date.now() - startTime,
        },
      });

      throw error;
    }
  }

  /**
   * Finalize a job with atomic update (used for completion or failure)
   */
  private async finalizeJob(
    jobId: string,
    status: ExportJobStatus,
    updates: Partial<ExportJob>,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const job = await queryRunner.manager
        .getRepository(ExportJob)
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :id', { id: jobId })
        .getOne();

      if (!job) {
        throw new Error(`Job ${jobId} not found during finalization`);
      }

      // Only allow finalization from PROCESSING state
      if (job.status !== ExportJobStatus.PROCESSING) {
        this.logger.warn(
          `Job ${jobId} cannot be finalized: status is ${job.status}, expected PROCESSING`,
        );
        await queryRunner.rollbackTransaction();
        return;
      }

      job.status = status;
      Object.assign(job, updates);

      await queryRunner.manager.save(job);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Creates an export stream for a given resource type
   */
  private async createExportStream(
    resourceType: ResourceType,
    format: ExportFormatEnum,
    filters: ExportFiltersDto | null,
    fields: string[] | null,
  ): Promise<Readable> {
    const passThrough = new PassThrough({ objectMode: true });

    // Start streaming data asynchronously
    this.streamRecords(resourceType, format, filters, fields, passThrough).catch((error) => {
      this.logger.error(`Error streaming records: ${error.message}`);
      passThrough.destroy(error);
    });

    // Transform to appropriate format
    if (format === ExportFormatEnum.NDJSON) {
      const ndjsonTransform = new NdjsonStringifyTransform();
      return passThrough.pipe(ndjsonTransform);
    } else if (format === ExportFormatEnum.JSON) {
      return this.wrapAsJsonArray(passThrough);
    } else {
      // CSV format
      return this.transformToCsv(passThrough, resourceType, fields);
    }
  }

  /**
   * Streams records from the database
   */
  private async streamRecords(
    resourceType: ResourceType,
    format: ExportFormatEnum,
    filters: ExportFiltersDto | null,
    fields: string[] | null,
    output: PassThrough,
  ): Promise<void> {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const records = await this.fetchRecordsBatch(
        resourceType,
        filters,
        fields,
        offset,
        this.batchSize,
      );

      if (records.length === 0) {
        hasMore = false;
      } else {
        for (const record of records) {
          const formattedRecord = this.formatRecord(record, resourceType, fields);
          output.write(formattedRecord);
        }
        offset += records.length;
        hasMore = records.length === this.batchSize;
      }
    }

    output.end();
  }

  /**
   * Fetches a batch of records from the database
   */
  private async fetchRecordsBatch(
    resourceType: ResourceType,
    filters: ExportFiltersDto | null,
    fields: string[] | null,
    offset: number,
    limit: number,
  ): Promise<unknown[]> {
    switch (resourceType) {
      case ResourceType.USERS:
        return this.fetchUsers(filters, fields, offset, limit);
      case ResourceType.ARTICLES:
        return this.fetchArticles(filters, fields, offset, limit);
      case ResourceType.COMMENTS:
        return this.fetchComments(filters, fields, offset, limit);
      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }
  }

  /**
   * Fetches users with filters
   */
  private async fetchUsers(
    filters: ExportFiltersDto | null,
    fields: string[] | null,
    offset: number,
    limit: number,
  ): Promise<User[]> {
    const qb = this.userRepository.createQueryBuilder('user');

    this.applyCommonFilters(qb, 'user', filters);

    if (filters?.active !== undefined) {
      qb.andWhere('user.active = :active', { active: filters.active });
    }

    qb.orderBy('user.createdAt', 'ASC').skip(offset).take(limit);

    return qb.getMany();
  }

  /**
   * Fetches articles with filters
   */
  private async fetchArticles(
    filters: ExportFiltersDto | null,
    fields: string[] | null,
    offset: number,
    limit: number,
  ): Promise<Article[]> {
    const qb = this.articleRepository.createQueryBuilder('article');

    this.applyCommonFilters(qb, 'article', filters);

    if (filters?.status) {
      qb.andWhere('article.status = :status', { status: filters.status });
    }

    if (filters?.authorId) {
      qb.andWhere('article.authorId = :authorId', { authorId: filters.authorId });
    }

    qb.orderBy('article.createdAt', 'ASC').skip(offset).take(limit);

    return qb.getMany();
  }

  /**
   * Fetches comments with filters
   */
  private async fetchComments(
    filters: ExportFiltersDto | null,
    fields: string[] | null,
    offset: number,
    limit: number,
  ): Promise<Comment[]> {
    const qb = this.commentRepository.createQueryBuilder('comment');

    this.applyCommonFilters(qb, 'comment', filters);

    if (filters?.articleId) {
      qb.andWhere('comment.articleId = :articleId', { articleId: filters.articleId });
    }

    if (filters?.userId) {
      qb.andWhere('comment.userId = :userId', { userId: filters.userId });
    }

    qb.orderBy('comment.createdAt', 'ASC').skip(offset).take(limit);

    return qb.getMany();
  }

  /**
   * Applies common filters to a query builder
   */
  private applyCommonFilters<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    filters: ExportFiltersDto | null,
  ): void {
    if (!filters) return;

    if (filters.ids && filters.ids.length > 0) {
      qb.andWhere(`${alias}.id IN (:...ids)`, { ids: filters.ids });
    }

    if (filters.createdAfter) {
      qb.andWhere(`${alias}.createdAt >= :createdAfter`, {
        createdAt: new Date(filters.createdAfter),
      });
    }

    if (filters.createdBefore) {
      qb.andWhere(`${alias}.createdAt <= :createdBefore`, {
        createdBefore: new Date(filters.createdBefore),
      });
    }

    if (filters.updatedAfter) {
      qb.andWhere(`${alias}.updatedAt >= :updatedAfter`, {
        updatedAfter: new Date(filters.updatedAfter),
      });
    }

    if (filters.updatedBefore) {
      qb.andWhere(`${alias}.updatedAt <= :updatedBefore`, {
        updatedBefore: new Date(filters.updatedBefore),
      });
    }
  }

  /**
   * Counts total records for a resource type with filters
   */
  private async countRecords(
    resourceType: ResourceType,
    filters: ExportFiltersDto | null,
  ): Promise<number> {
    switch (resourceType) {
      case ResourceType.USERS: {
        const qb = this.userRepository.createQueryBuilder('user');
        this.applyCommonFilters(qb, 'user', filters);
        if (filters?.active !== undefined) {
          qb.andWhere('user.active = :active', { active: filters.active });
        }
        return qb.getCount();
      }
      case ResourceType.ARTICLES: {
        const qb = this.articleRepository.createQueryBuilder('article');
        this.applyCommonFilters(qb, 'article', filters);
        if (filters?.status) {
          qb.andWhere('article.status = :status', { status: filters.status });
        }
        if (filters?.authorId) {
          qb.andWhere('article.authorId = :authorId', { authorId: filters.authorId });
        }
        return qb.getCount();
      }
      case ResourceType.COMMENTS: {
        const qb = this.commentRepository.createQueryBuilder('comment');
        this.applyCommonFilters(qb, 'comment', filters);
        if (filters?.articleId) {
          qb.andWhere('comment.articleId = :articleId', { articleId: filters.articleId });
        }
        if (filters?.userId) {
          qb.andWhere('comment.userId = :userId', { userId: filters.userId });
        }
        return qb.getCount();
      }
      default:
        return 0;
    }
  }

  /**
   * Formats a record for export
   */
  private formatRecord(
    record: unknown,
    resourceType: ResourceType,
    fields: string[] | null,
  ): Record<string, unknown> {
    const entity = record as Record<string, unknown>;

    // Map entity fields to export format
    let formatted: Record<string, unknown>;

    switch (resourceType) {
      case ResourceType.USERS:
        formatted = {
          id: entity.id,
          email: entity.email,
          name: entity.name,
          role: entity.role,
          active: entity.active,
          created_at: entity.createdAt,
          updated_at: entity.updatedAt,
        };
        break;
      case ResourceType.ARTICLES:
        formatted = {
          id: entity.id,
          slug: entity.slug,
          title: entity.title,
          body: entity.body,
          author_id: entity.authorId,
          tags: entity.tags,
          status: entity.status,
          published_at: entity.publishedAt,
          created_at: entity.createdAt,
          updated_at: entity.updatedAt,
        };
        break;
      case ResourceType.COMMENTS:
        formatted = {
          id: entity.id,
          article_id: entity.articleId,
          user_id: entity.userId,
          body: entity.body,
          created_at: entity.createdAt,
        };
        break;
      default:
        formatted = entity;
    }

    // Filter fields if specified
    if (fields && fields.length > 0) {
      const filtered: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in formatted) {
          filtered[field] = formatted[field];
        }
      }
      return filtered;
    }

    return formatted;
  }

  /**
   * Wraps a stream of objects as a JSON array
   */
  private wrapAsJsonArray(input: PassThrough): Readable {
    const output = new PassThrough();
    let first = true;

    output.write('[');

    input.on('data', (chunk) => {
      if (!first) {
        output.write(',');
      }
      first = false;
      output.write(JSON.stringify(chunk));
    });

    input.on('end', () => {
      output.write(']');
      output.end();
    });

    input.on('error', (error) => {
      output.destroy(error);
    });

    return output;
  }

  /**
   * Transforms a stream of objects to CSV format
   */
  private transformToCsv(
    input: PassThrough,
    resourceType: ResourceType,
    fields: string[] | null,
  ): Readable {
    const output = new PassThrough();
    let headerWritten = false;

    const getHeaders = (resourceType: ResourceType): string[] => {
      switch (resourceType) {
        case ResourceType.USERS:
          return ['id', 'email', 'name', 'role', 'active', 'created_at', 'updated_at'];
        case ResourceType.ARTICLES:
          return [
            'id',
            'slug',
            'title',
            'body',
            'author_id',
            'tags',
            'status',
            'published_at',
            'created_at',
            'updated_at',
          ];
        case ResourceType.COMMENTS:
          return ['id', 'article_id', 'user_id', 'body', 'created_at'];
        default:
          return [];
      }
    };

    const headers = fields && fields.length > 0 ? fields : getHeaders(resourceType);

    const escapeCSV = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    input.on('data', (chunk: Record<string, unknown>) => {
      if (!headerWritten) {
        output.write(headers.join(',') + '\n');
        headerWritten = true;
      }
      const values = headers.map((h) => escapeCSV(chunk[h]));
      output.write(values.join(',') + '\n');
    });

    input.on('end', () => {
      output.end();
    });

    input.on('error', (error) => {
      output.destroy(error);
    });

    return output;
  }

  /**
   * Gets content type for a format
   */
  private getContentType(format: ExportFormatEnum): string {
    switch (format) {
      case ExportFormatEnum.CSV:
        return 'text/csv';
      case ExportFormatEnum.NDJSON:
        return 'application/x-ndjson';
      default:
        return 'application/json';
    }
  }

  /**
   * Converts an ExportJob entity to a response DTO
   */
  private toResponseDto(job: ExportJob): ExportJobResponseDto {
    return {
      id: job.id,
      resourceType: job.resourceType,
      format: job.format as unknown as ExportFormatEnum,
      status: job.status,
      filters: job.filters || undefined,
      fields: job.fields || undefined,
      downloadUrl: job.downloadUrl || undefined,
      fileName: job.fileName || undefined,
      fileSize: job.fileSize || undefined,
      totalRows: job.totalRows,
      exportedRows: job.exportedRows,
      progressPercentage: job.progressPercentage,
      metrics: job.metrics || undefined,
      errorMessage: job.errorMessage || undefined,
      expiresAt: job.expiresAt || undefined,
      startedAt: job.startedAt || undefined,
      completedAt: job.completedAt || undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
