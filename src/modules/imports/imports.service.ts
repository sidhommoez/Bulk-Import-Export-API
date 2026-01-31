import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { parse as csvParse } from 'csv-parse';
import { v4 as uuidv4 } from 'uuid';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ImportJob,
  ImportJobStatus,
  ImportJobError,
  ResourceType,
  User,
  Article,
  Comment,
  ArticleStatus,
} from '@/database/entities';
import { StorageService } from '@/storage/storage.service';
import { QUEUE_NAMES, JOB_NAMES, ImportJobData } from '@/queue/queue.constants';
import { CreateImportDto, ImportJobResponseDto } from './dto/create-import.dto';
import {
  ImportUserRecordDto,
  ImportArticleRecordDto,
  ImportCommentRecordDto,
  ValidatedImportRecord,
  ImportBatchResult,
  IMPORT_RECORD_DTO_MAP,
} from './dto/import-records.dto';
import { NdjsonParseTransform, BatchTransform } from '@/common/utils/stream.utils';
import {
  isValidSlug,
  countWords,
  isValidUUID,
  flattenValidationErrors,
} from '@/common/utils/validation.utils';
import { DistributedLockService } from '@/common/services/distributed-lock.service';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly batchSize: number;
  private readonly maxErrors = 100; // Maximum errors to store in job record

  constructor(
    @InjectRepository(ImportJob)
    private readonly importJobRepository: Repository<ImportJob>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Article)
    private readonly articleRepository: Repository<Article>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectQueue(QUEUE_NAMES.IMPORT)
    private readonly importQueue: Queue,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly distributedLockService: DistributedLockService,
  ) {
    this.batchSize = this.configService.get<number>('job.batchSize', 1000);
  }

  /**
   * Creates a new import job from a file upload
   */
  async createImportFromFile(
    file: Express.Multer.File,
    dto: { resourceType: ResourceType; format?: string },
    idempotencyKey?: string,
  ): Promise<ImportJobResponseDto> {
    // Check idempotency
    if (idempotencyKey) {
      const existingJob = await this.findByIdempotencyKey(idempotencyKey);
      if (existingJob) {
        this.logger.log(`Returning existing job for idempotency key: ${idempotencyKey}`);
        return this.toResponseDto(existingJob);
      }
    }

    // Determine file format
    const format = dto.format || this.detectFormat(file.originalname);
    if (!['json', 'ndjson', 'csv'].includes(format)) {
      throw new ConflictException(`Unsupported file format: ${format}`);
    }

    // Create job record
    const job = this.importJobRepository.create({
      idempotencyKey,
      resourceType: dto.resourceType,
      status: ImportJobStatus.PENDING,
      fileName: file.originalname,
      fileSize: file.size,
      fileFormat: format,
      totalRows: 0,
      processedRows: 0,
      successfulRows: 0,
      failedRows: 0,
      skippedRows: 0,
      errors: [],
    });

    await this.importJobRepository.save(job);

    // Upload file to S3
    const storageKey = this.storageService.generateImportKey(job.id, file.originalname);
    await this.storageService.uploadBuffer(storageKey, file.buffer, {
      contentType: this.getContentType(format),
      metadata: {
        jobId: job.id,
        resourceType: dto.resourceType,
        format,
      },
    });

    // Update job with file URL
    job.fileUrl = storageKey;
    await this.importJobRepository.save(job);

    // Queue the import job
    await this.importQueue.add(
      JOB_NAMES.PROCESS_IMPORT,
      {
        jobId: job.id,
        resourceType: dto.resourceType,
        filePath: storageKey,
        fileFormat: format,
        idempotencyKey,
      } as ImportJobData,
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(`Created import job ${job.id} for ${dto.resourceType}`);
    return this.toResponseDto(job);
  }

  /**
   * Creates a new import job from a remote URL
   */
  async createImportFromUrl(
    dto: CreateImportDto,
    idempotencyKey?: string,
  ): Promise<ImportJobResponseDto> {
    // Check idempotency
    if (idempotencyKey) {
      const existingJob = await this.findByIdempotencyKey(idempotencyKey);
      if (existingJob) {
        this.logger.log(`Returning existing job for idempotency key: ${idempotencyKey}`);
        return this.toResponseDto(existingJob);
      }
    }

    if (!dto.fileUrl) {
      throw new ConflictException('fileUrl is required when not uploading a file');
    }

    // Determine file format
    const format = dto.format || this.detectFormat(dto.fileUrl);
    if (!['json', 'ndjson', 'csv'].includes(format)) {
      throw new ConflictException(`Unsupported file format: ${format}`);
    }

    // Create job record
    const job = this.importJobRepository.create({
      idempotencyKey,
      resourceType: dto.resourceType,
      status: ImportJobStatus.PENDING,
      fileUrl: dto.fileUrl,
      fileFormat: format,
      totalRows: 0,
      processedRows: 0,
      successfulRows: 0,
      failedRows: 0,
      skippedRows: 0,
      errors: [],
    });

    await this.importJobRepository.save(job);

    // Queue the import job
    await this.importQueue.add(
      JOB_NAMES.PROCESS_IMPORT,
      {
        jobId: job.id,
        resourceType: dto.resourceType,
        fileUrl: dto.fileUrl,
        fileFormat: format,
        idempotencyKey,
      } as ImportJobData,
      {
        jobId: job.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(`Created import job ${job.id} for ${dto.resourceType} from URL`);
    return this.toResponseDto(job);
  }

  /**
   * Gets an import job by ID
   */
  async getJob(jobId: string): Promise<ImportJobResponseDto> {
    const job = await this.importJobRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }
    return this.toResponseDto(job);
  }

  /**
   * Finds a job by idempotency key
   */
  async findByIdempotencyKey(key: string): Promise<ImportJob | null> {
    return this.importJobRepository.findOne({ where: { idempotencyKey: key } });
  }

  /**
   * Processes an import job (called by the queue processor)
   * Uses distributed locking to ensure only one node processes a job at a time
   */
  async processImport(jobData: ImportJobData): Promise<void> {
    const lockKey = `import-job:${jobData.jobId}`;
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
      // Uses optimistic locking via version column and row-level lock
      const transitionResult = await this.atomicStatusTransition(
        jobData.jobId,
        ImportJobStatus.PENDING,
        ImportJobStatus.PROCESSING,
        { lockedBy: nodeId, lockedAt: new Date(), startedAt: new Date() },
      );

      if (!transitionResult.success) {
        this.logger.warn(
          `Job ${jobData.jobId} status transition failed: ${transitionResult.reason}`,
        );
        return;
      }

      const job = transitionResult.job!;
      await this.executeImportProcessing(job, jobData);
    } finally {
      // Always release the distributed lock
      await this.distributedLockService.releaseLock(lock);
    }
  }

  /**
   * Atomically transition job status with optimistic locking
   * Returns success/failure and the updated job
   */
  private async atomicStatusTransition(
    jobId: string,
    fromStatus: ImportJobStatus,
    toStatus: ImportJobStatus,
    additionalUpdates?: Partial<ImportJob>,
  ): Promise<{ success: boolean; job?: ImportJob; reason?: string }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      // Lock the row for update to prevent concurrent modifications
      const job = await queryRunner.manager
        .getRepository(ImportJob)
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
   * Execute the actual import processing logic
   */
  private async executeImportProcessing(job: ImportJob, jobData: ImportJobData): Promise<void> {
    const startTime = Date.now();
    let totalRows = 0;
    let processedRows = 0;
    let successfulRows = 0;
    let failedRows = 0;
    let skippedRows = 0;
    const errors: ImportJobError[] = [];

    try {
      // Get the file stream
      let stream: Readable;
      if (jobData.filePath) {
        stream = await this.storageService.getStream(jobData.filePath);
      } else if (jobData.fileUrl) {
        // Fetch from remote URL
        const response = await fetch(jobData.fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file from URL: ${response.statusText}`);
        }
        stream = Readable.fromWeb(response.body as any);
      } else {
        throw new Error('No file path or URL provided');
      }

      // Process based on format
      if (jobData.fileFormat === 'csv') {
        const result = await this.processCSVStream(stream, job.resourceType, job.id);
        totalRows = result.totalRows;
        processedRows = result.processedRows;
        successfulRows = result.successfulRows;
        failedRows = result.failedRows;
        skippedRows = result.skippedRows;
        errors.push(...result.errors);
      } else if (jobData.fileFormat === 'ndjson') {
        const result = await this.processNDJSONStream(stream, job.resourceType, job.id);
        totalRows = result.totalRows;
        processedRows = result.processedRows;
        successfulRows = result.successfulRows;
        failedRows = result.failedRows;
        skippedRows = result.skippedRows;
        errors.push(...result.errors);
      } else {
        // JSON - parse entire file
        const result = await this.processJSONStream(stream, job.resourceType, job.id);
        totalRows = result.totalRows;
        processedRows = result.processedRows;
        successfulRows = result.successfulRows;
        failedRows = result.failedRows;
        skippedRows = result.skippedRows;
        errors.push(...result.errors);
      }

      // Calculate metrics
      const durationMs = Date.now() - startTime;
      const rowsPerSecond = durationMs > 0 ? Math.round((processedRows / durationMs) * 1000) : 0;
      const errorRate = totalRows > 0 ? failedRows / totalRows : 0;

      // Atomic transition to COMPLETED with final metrics
      await this.finalizeJob(job.id, ImportJobStatus.COMPLETED, {
        totalRows,
        processedRows,
        successfulRows,
        failedRows,
        skippedRows,
        errors: errors.slice(0, this.maxErrors),
        completedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        metrics: {
          rowsPerSecond,
          errorRate,
          durationMs,
        },
      });

      this.logger.log(
        `Completed import job ${job.id}: ${successfulRows}/${totalRows} successful, ` +
          `${failedRows} failed, ${skippedRows} skipped, ${rowsPerSecond} rows/sec`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Import job ${job.id} failed: ${errorMessage}`);

      // Atomic transition to FAILED
      await this.finalizeJob(job.id, ImportJobStatus.FAILED, {
        errorMessage,
        completedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        metrics: {
          rowsPerSecond: 0,
          errorRate: 1,
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
    status: ImportJobStatus,
    updates: Partial<ImportJob>,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const job = await queryRunner.manager
        .getRepository(ImportJob)
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :id', { id: jobId })
        .getOne();

      if (!job) {
        throw new Error(`Job ${jobId} not found during finalization`);
      }

      // Only allow finalization from PROCESSING state
      if (job.status !== ImportJobStatus.PROCESSING) {
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
   * Processes a CSV stream
   */
  private async processCSVStream(
    stream: Readable,
    resourceType: ResourceType,
    jobId: string,
  ): Promise<{
    totalRows: number;
    processedRows: number;
    successfulRows: number;
    failedRows: number;
    skippedRows: number;
    errors: ImportJobError[];
  }> {
    const errors: ImportJobError[] = [];
    let totalRows = 0;
    let processedRows = 0;
    let successfulRows = 0;
    let failedRows = 0;
    let skippedRows = 0;

    const parser = stream.pipe(
      csvParse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true,
        cast_date: false, // We'll handle dates manually
      }),
    );

    const batchTransform = new BatchTransform<Record<string, unknown>>(this.batchSize);
    let batchNumber = 0;

    parser.pipe(batchTransform);

    for await (const batch of batchTransform) {
      batchNumber++;
      const startRow = (batchNumber - 1) * this.batchSize + 1;
      totalRows += (batch as unknown[]).length;

      const result = await this.processBatch(
        batch as Record<string, unknown>[],
        resourceType,
        startRow,
      );

      processedRows += (batch as unknown[]).length;
      successfulRows += result.successful;
      failedRows += result.failed;
      skippedRows += result.skipped;

      if (errors.length < this.maxErrors) {
        errors.push(...result.errors.slice(0, this.maxErrors - errors.length));
      }

      // Update job progress periodically
      if (batchNumber % 10 === 0) {
        await this.updateJobProgress(
          jobId,
          totalRows,
          processedRows,
          successfulRows,
          failedRows,
          skippedRows,
        );
      }
    }

    return { totalRows, processedRows, successfulRows, failedRows, skippedRows, errors };
  }

  /**
   * Processes an NDJSON stream
   */
  private async processNDJSONStream(
    stream: Readable,
    resourceType: ResourceType,
    jobId: string,
  ): Promise<{
    totalRows: number;
    processedRows: number;
    successfulRows: number;
    failedRows: number;
    skippedRows: number;
    errors: ImportJobError[];
  }> {
    const errors: ImportJobError[] = [];
    let totalRows = 0;
    let processedRows = 0;
    let successfulRows = 0;
    let failedRows = 0;
    let skippedRows = 0;

    const ndjsonParser = new NdjsonParseTransform();
    const batchTransform = new BatchTransform<{
      data?: unknown;
      error?: string;
      lineNumber: number;
    }>(this.batchSize);

    stream.pipe(ndjsonParser).pipe(batchTransform);

    let batchNumber = 0;

    for await (const batch of batchTransform) {
      batchNumber++;
      const typedBatch = batch as Array<{ data?: unknown; error?: string; lineNumber: number }>;
      totalRows += typedBatch.length;

      // Separate valid and invalid records
      const validRecords: Array<{ data: Record<string, unknown>; lineNumber: number }> = [];
      for (const item of typedBatch) {
        if (item.error) {
          failedRows++;
          if (errors.length < this.maxErrors) {
            errors.push({
              row: item.lineNumber,
              message: item.error,
            });
          }
        } else if (item.data) {
          validRecords.push({
            data: item.data as Record<string, unknown>,
            lineNumber: item.lineNumber,
          });
        }
      }

      if (validRecords.length > 0) {
        const result = await this.processBatchWithLineNumbers(validRecords, resourceType);
        processedRows += validRecords.length;
        successfulRows += result.successful;
        failedRows += result.failed;
        skippedRows += result.skipped;

        if (errors.length < this.maxErrors) {
          errors.push(...result.errors.slice(0, this.maxErrors - errors.length));
        }
      }

      // Update job progress periodically
      if (batchNumber % 10 === 0) {
        await this.updateJobProgress(
          jobId,
          totalRows,
          processedRows,
          successfulRows,
          failedRows,
          skippedRows,
        );
      }
    }

    return { totalRows, processedRows, successfulRows, failedRows, skippedRows, errors };
  }

  /**
   * Processes a JSON stream (array of objects)
   */
  private async processJSONStream(
    stream: Readable,
    resourceType: ResourceType,
    jobId: string,
  ): Promise<{
    totalRows: number;
    processedRows: number;
    successfulRows: number;
    failedRows: number;
    skippedRows: number;
    errors: ImportJobError[];
  }> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    const content = Buffer.concat(chunks).toString('utf-8');
    let data: unknown[];

    try {
      data = JSON.parse(content);
      if (!Array.isArray(data)) {
        throw new Error('JSON file must contain an array of objects');
      }
    } catch (error) {
      throw new Error(`Invalid JSON: ${(error as Error).message}`);
    }

    const errors: ImportJobError[] = [];
    const totalRows = data.length;
    let processedRows = 0;
    let successfulRows = 0;
    let failedRows = 0;
    let skippedRows = 0;

    // Process in batches
    for (let i = 0; i < data.length; i += this.batchSize) {
      const batch = data.slice(i, i + this.batchSize);
      const startRow = i + 1;

      const result = await this.processBatch(
        batch as Record<string, unknown>[],
        resourceType,
        startRow,
      );

      processedRows += batch.length;
      successfulRows += result.successful;
      failedRows += result.failed;
      skippedRows += result.skipped;

      if (errors.length < this.maxErrors) {
        errors.push(...result.errors.slice(0, this.maxErrors - errors.length));
      }

      // Update progress
      await this.updateJobProgress(
        jobId,
        totalRows,
        processedRows,
        successfulRows,
        failedRows,
        skippedRows,
      );
    }

    return { totalRows, processedRows, successfulRows, failedRows, skippedRows, errors };
  }

  /**
   * Processes a batch of records
   */
  private async processBatch(
    batch: Record<string, unknown>[],
    resourceType: ResourceType,
    startRow: number,
  ): Promise<ImportBatchResult> {
    const records = batch.map((data, index) => ({
      data,
      lineNumber: startRow + index,
    }));
    return this.processBatchWithLineNumbers(records, resourceType);
  }

  /**
   * Processes a batch of records with line numbers
   */
  private async processBatchWithLineNumbers(
    records: Array<{ data: Record<string, unknown>; lineNumber: number }>,
    resourceType: ResourceType,
  ): Promise<ImportBatchResult> {
    const errors: ImportJobError[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    // Validate all records first
    const validatedRecords: ValidatedImportRecord[] = await Promise.all(
      records.map(async ({ data, lineNumber }) => {
        return this.validateRecord(data, resourceType, lineNumber);
      }),
    );

    // Separate valid and invalid records
    const validRecords = validatedRecords.filter((r) => r.isValid);
    const invalidRecords = validatedRecords.filter((r) => !r.isValid);

    // Add validation errors
    for (const record of invalidRecords) {
      failed++;
      if (record.errors && errors.length < this.maxErrors) {
        for (const error of record.errors) {
          errors.push({
            row: record.lineNumber,
            field: error.field,
            message: error.message,
            value: error.value,
          });
        }
      }
    }

    // Process valid records based on resource type
    if (validRecords.length > 0) {
      const result = await this.upsertRecords(validRecords, resourceType);
      successful += result.successful;
      skipped += result.skipped;
      failed += result.failed;
      errors.push(...result.errors);
    }

    return { successful, failed, skipped, errors };
  }

  /**
   * Validates a single record
   */
  private async validateRecord(
    data: Record<string, unknown>,
    resourceType: ResourceType,
    lineNumber: number,
  ): Promise<ValidatedImportRecord> {
    const dtoClass = IMPORT_RECORD_DTO_MAP[resourceType] as ClassConstructor<unknown>;

    // Transform and validate using class-transformer and class-validator
    const instance = plainToInstance(dtoClass, data, {
      enableImplicitConversion: true,
    }) as Record<string, unknown>;

    const validationErrors = await validate(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: false,
      skipMissingProperties: false,
    });

    if (validationErrors.length > 0) {
      const errors = flattenValidationErrors(validationErrors);
      return {
        isValid: false,
        errors,
        lineNumber,
        raw: data,
      };
    }

    // Additional validation based on resource type
    const additionalErrors: Array<{ field: string; message: string; value?: unknown }> = [];

    if (resourceType === ResourceType.ARTICLES) {
      const articleData = instance as unknown as ImportArticleRecordDto;

      // Check that draft articles don't have published_at
      if (articleData.status === ArticleStatus.DRAFT && articleData.published_at) {
        additionalErrors.push({
          field: 'published_at',
          message: 'Draft articles must not have a published_at date',
          value: articleData.published_at,
        });
      }

      // Validate slug is kebab-case
      if (articleData.slug && !isValidSlug(articleData.slug)) {
        additionalErrors.push({
          field: 'slug',
          message: 'Slug must be in kebab-case format',
          value: articleData.slug,
        });
      }
    }

    if (resourceType === ResourceType.COMMENTS) {
      const commentData = instance as unknown as ImportCommentRecordDto;

      // Check body length (max 500 words)
      const wordCount = countWords(commentData.body);
      if (wordCount > 500) {
        additionalErrors.push({
          field: 'body',
          message: `Comment body exceeds 500 words (has ${wordCount} words)`,
          value: commentData.body.substring(0, 100) + '...',
        });
      }
    }

    if (additionalErrors.length > 0) {
      return {
        isValid: false,
        errors: additionalErrors,
        lineNumber,
        raw: data,
      };
    }

    return {
      isValid: true,
      data: instance,
      lineNumber,
    };
  }

  /**
   * Upserts validated records into the database
   */
  private async upsertRecords(
    records: ValidatedImportRecord[],
    resourceType: ResourceType,
  ): Promise<{ successful: number; failed: number; skipped: number; errors: ImportJobError[] }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const errors: ImportJobError[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    try {
      switch (resourceType) {
        case ResourceType.USERS: {
          const userResult = await this.upsertUsers(records, queryRunner);
          successful = userResult.successful;
          failed = userResult.failed;
          skipped = userResult.skipped;
          errors.push(...userResult.errors);
          break;
        }

        case ResourceType.ARTICLES: {
          const articleResult = await this.upsertArticles(records, queryRunner);
          successful = articleResult.successful;
          failed = articleResult.failed;
          skipped = articleResult.skipped;
          errors.push(...articleResult.errors);
          break;
        }

        case ResourceType.COMMENTS: {
          const commentResult = await this.upsertComments(records, queryRunner);
          successful = commentResult.successful;
          failed = commentResult.failed;
          skipped = commentResult.skipped;
          errors.push(...commentResult.errors);
          break;
        }
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to upsert batch: ${(error as Error).message}`);

      // Mark all as failed
      for (const record of records) {
        failed++;
        errors.push({
          row: record.lineNumber,
          message: `Database error: ${(error as Error).message}`,
        });
      }
    } finally {
      await queryRunner.release();
    }

    return { successful, failed, skipped, errors };
  }

  /**
   * Upserts user records
   */
  private async upsertUsers(
    records: ValidatedImportRecord[],
    queryRunner: QueryRunner,
  ): Promise<{ successful: number; failed: number; skipped: number; errors: ImportJobError[] }> {
    const errors: ImportJobError[] = [];
    let successful = 0;
    let failed = 0;
    const skipped = 0;

    // Track emails seen in this batch to detect duplicates within the file
    const seenEmailsInBatch = new Map<string, number>(); // email -> first line number

    // Get existing users by email for upsert
    const emails = records.map((r) => (r.data as ImportUserRecordDto).email);
    const existingUsers = await queryRunner.manager.find(User, {
      where: emails.map((email) => ({ email })),
    });
    const emailToUser = new Map(existingUsers.map((u) => [u.email, u]));

    for (const record of records) {
      const userData = record.data as ImportUserRecordDto;
      const emailLower = userData.email.toLowerCase();

      // Check for duplicate email within the same import file
      if (seenEmailsInBatch.has(emailLower)) {
        failed++;
        errors.push({
          row: record.lineNumber,
          field: 'email',
          message: `Duplicate email in import file: ${userData.email} (first seen on row ${seenEmailsInBatch.get(emailLower)})`,
          value: userData.email,
        });
        continue;
      }
      seenEmailsInBatch.set(emailLower, record.lineNumber);

      const savepointName = `user_${record.lineNumber}`;
      try {
        // Create savepoint to isolate this record's transaction
        await queryRunner.query(`SAVEPOINT ${savepointName}`);

        const existingUser = emailToUser.get(userData.email);

        if (existingUser) {
          // Update existing user
          existingUser.name = userData.name;
          existingUser.role = userData.role;
          existingUser.active = userData.active;
          if (userData.updated_at) {
            existingUser.updatedAt = new Date(userData.updated_at);
          }
          await queryRunner.manager.save(existingUser);
          successful++;
        } else {
          // Create new user
          const newUser = queryRunner.manager.create(User, {
            id: userData.id || uuidv4(),
            email: userData.email,
            name: userData.name,
            role: userData.role,
            active: userData.active,
            createdAt: userData.created_at ? new Date(userData.created_at) : undefined,
            updatedAt: userData.updated_at ? new Date(userData.updated_at) : undefined,
          });
          await queryRunner.manager.save(newUser);
          successful++;
        }

        // Release savepoint on success
        await queryRunner.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (error) {
        // Rollback to savepoint to recover transaction state
        await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        failed++;
        const errorMessage = (error as Error).message;

        // Check for unique constraint violation
        if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
          errors.push({
            row: record.lineNumber,
            field: 'email',
            message: `Duplicate email: ${userData.email}`,
            value: userData.email,
          });
        } else if (errorMessage.includes('invalid input value for enum user_role_enum')) {
          errors.push({
            row: record.lineNumber,
            field: 'role',
            message: `Invalid role: ${userData.role}. Must be one of: admin, manager, author, editor, reader`,
            value: userData.role,
          });
        } else {
          errors.push({
            row: record.lineNumber,
            message: errorMessage,
          });
        }
      }
    }

    return { successful, failed, skipped, errors };
  }

  /**
   * Upserts article records
   */
  private async upsertArticles(
    records: ValidatedImportRecord[],
    queryRunner: QueryRunner,
  ): Promise<{ successful: number; failed: number; skipped: number; errors: ImportJobError[] }> {
    const errors: ImportJobError[] = [];
    let successful = 0;
    let failed = 0;
    const skipped = 0;

    // Track slugs seen in this batch to detect duplicates within the file
    const seenSlugsInBatch = new Map<string, number>(); // slug -> first line number

    // Get existing articles by slug for upsert
    const slugs = records.map((r) => (r.data as ImportArticleRecordDto).slug);
    const existingArticles = await queryRunner.manager.find(Article, {
      where: slugs.map((slug) => ({ slug })),
    });
    const slugToArticle = new Map(existingArticles.map((a) => [a.slug, a]));

    // Get valid author IDs (any user can be an author)
    const authorIds = [
      ...new Set(records.map((r) => (r.data as ImportArticleRecordDto).author_id)),
    ];
    const validAuthors = await queryRunner.manager.find(User, {
      where: authorIds.filter((id) => isValidUUID(id)).map((id) => ({ id })),
      select: ['id'],
    });
    const validAuthorIds = new Set(validAuthors.map((a) => a.id));

    for (const record of records) {
      const articleData = record.data as ImportArticleRecordDto;

      // Check for duplicate slug within the same import file
      if (seenSlugsInBatch.has(articleData.slug)) {
        failed++;
        errors.push({
          row: record.lineNumber,
          field: 'slug',
          message: `Duplicate slug in import file: ${articleData.slug} (first seen on row ${seenSlugsInBatch.get(articleData.slug)})`,
          value: articleData.slug,
        });
        continue;
      }
      seenSlugsInBatch.set(articleData.slug, record.lineNumber);

      // Check if author exists
      if (!validAuthorIds.has(articleData.author_id)) {
        failed++;
        errors.push({
          row: record.lineNumber,
          field: 'author_id',
          message: `Invalid author_id: ${articleData.author_id} does not exist`,
          value: articleData.author_id,
        });
        continue;
      }

      const savepointName = `article_${record.lineNumber}`;
      try {
        // Create savepoint to isolate this record's transaction
        await queryRunner.query(`SAVEPOINT ${savepointName}`);

        const existingArticle = slugToArticle.get(articleData.slug);

        if (existingArticle) {
          // Update existing article
          existingArticle.title = articleData.title;
          existingArticle.body = articleData.body;
          existingArticle.authorId = articleData.author_id;
          existingArticle.tags = articleData.tags || [];
          existingArticle.status = articleData.status;
          existingArticle.publishedAt = articleData.published_at
            ? new Date(articleData.published_at)
            : null;
          if (articleData.updated_at) {
            existingArticle.updatedAt = new Date(articleData.updated_at);
          }
          await queryRunner.manager.save(existingArticle);
          successful++;
        } else {
          // Create new article
          const newArticle = queryRunner.manager.create(Article, {
            id: articleData.id || uuidv4(),
            slug: articleData.slug,
            title: articleData.title,
            body: articleData.body,
            authorId: articleData.author_id,
            tags: articleData.tags || [],
            status: articleData.status,
            publishedAt: articleData.published_at ? new Date(articleData.published_at) : null,
            createdAt: articleData.created_at ? new Date(articleData.created_at) : undefined,
            updatedAt: articleData.updated_at ? new Date(articleData.updated_at) : undefined,
          });
          await queryRunner.manager.save(newArticle);
          successful++;
        }

        // Release savepoint on success
        await queryRunner.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (error) {
        // Rollback to savepoint to recover transaction state
        await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        failed++;
        const errorMessage = (error as Error).message;

        if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
          errors.push({
            row: record.lineNumber,
            field: 'slug',
            message: `Duplicate slug: ${articleData.slug}`,
            value: articleData.slug,
          });
        } else if (errorMessage.includes('invalid input value for enum article_status_enum')) {
          errors.push({
            row: record.lineNumber,
            field: 'status',
            message: `Invalid status: ${articleData.status}. Must be one of: draft, published, archived`,
            value: articleData.status,
          });
        } else {
          errors.push({
            row: record.lineNumber,
            message: errorMessage,
          });
        }
      }
    }

    return { successful, failed, skipped, errors };
  }

  /**
   * Upserts comment records
   */
  private async upsertComments(
    records: ValidatedImportRecord[],
    queryRunner: QueryRunner,
  ): Promise<{ successful: number; failed: number; skipped: number; errors: ImportJobError[] }> {
    const errors: ImportJobError[] = [];
    let successful = 0;
    let failed = 0;
    const skipped = 0;

    // Get valid article IDs
    const articleIds = [
      ...new Set(records.map((r) => (r.data as ImportCommentRecordDto).article_id)),
    ];
    const validArticles = await queryRunner.manager.find(Article, {
      where: articleIds.filter((id) => isValidUUID(id)).map((id) => ({ id })),
      select: ['id'],
    });
    const validArticleIds = new Set(validArticles.map((a) => a.id));

    // Get valid user IDs (any user can comment)
    const userIds = [...new Set(records.map((r) => (r.data as ImportCommentRecordDto).user_id))];
    const validUsers = await queryRunner.manager.find(User, {
      where: userIds.filter((id) => isValidUUID(id)).map((id) => ({ id })),
      select: ['id'],
    });
    const validUserIds = new Set(validUsers.map((u) => u.id));

    for (const record of records) {
      const commentData = record.data as ImportCommentRecordDto;

      // Strip cm_ prefix from ID if present and validate
      let commentId = commentData.id;
      if (commentId && commentId.startsWith('cm_')) {
        commentId = commentId.substring(3); // Remove 'cm_' prefix
      }

      // Check if article exists
      if (!validArticleIds.has(commentData.article_id)) {
        failed++;
        errors.push({
          row: record.lineNumber,
          field: 'article_id',
          message: `Invalid foreign key: article_id ${commentData.article_id} does not exist`,
          value: commentData.article_id,
        });
        continue;
      }

      // Check if user exists
      if (!validUserIds.has(commentData.user_id)) {
        failed++;
        errors.push({
          row: record.lineNumber,
          field: 'user_id',
          message: `Invalid user_id: ${commentData.user_id} does not exist`,
          value: commentData.user_id,
        });
        continue;
      }

      const savepointName = `comment_${record.lineNumber}`;
      try {
        // Create savepoint to isolate this record's transaction
        await queryRunner.query(`SAVEPOINT ${savepointName}`);

        // Check for existing comment with same ID
        if (commentId) {
          const existingComment = await queryRunner.manager.findOne(Comment, {
            where: { id: commentId },
          });

          if (existingComment) {
            // Update existing comment
            existingComment.body = commentData.body;
            existingComment.articleId = commentData.article_id;
            existingComment.userId = commentData.user_id;
            await queryRunner.manager.save(existingComment);
            successful++;
            // Release savepoint on success
            await queryRunner.query(`RELEASE SAVEPOINT ${savepointName}`);
            continue;
          }
        }

        // Create new comment
        const newComment = queryRunner.manager.create(Comment, {
          id: commentId || uuidv4(),
          articleId: commentData.article_id,
          userId: commentData.user_id,
          body: commentData.body,
          createdAt: commentData.created_at ? new Date(commentData.created_at) : undefined,
        });
        await queryRunner.manager.save(newComment);
        successful++;

        // Release savepoint on success
        await queryRunner.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (error) {
        // Rollback to savepoint to recover transaction state
        await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        failed++;
        errors.push({
          row: record.lineNumber,
          message: (error as Error).message,
        });
      }
    }

    return { successful, failed, skipped, errors };
  }

  /**
   * Updates job progress
   */
  private async updateJobProgress(
    jobId: string,
    totalRows: number,
    processedRows: number,
    successfulRows: number,
    failedRows: number,
    skippedRows: number,
  ): Promise<void> {
    await this.importJobRepository.update(jobId, {
      totalRows,
      processedRows,
      successfulRows,
      failedRows,
      skippedRows,
    });
  }

  /**
   * Detects file format from filename
   */
  private detectFormat(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'csv') return 'csv';
    if (ext === 'ndjson' || ext === 'jsonl') return 'ndjson';
    return 'json';
  }

  /**
   * Gets content type for a format
   */
  private getContentType(format: string): string {
    switch (format) {
      case 'csv':
        return 'text/csv';
      case 'ndjson':
        return 'application/x-ndjson';
      default:
        return 'application/json';
    }
  }

  /**
   * Converts an ImportJob entity to a response DTO
   */
  private toResponseDto(job: ImportJob): ImportJobResponseDto {
    return {
      id: job.id,
      resourceType: job.resourceType,
      status: job.status,
      idempotencyKey: job.idempotencyKey || undefined,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      successfulRows: job.successfulRows,
      failedRows: job.failedRows,
      skippedRows: job.skippedRows,
      progressPercentage: job.progressPercentage,
      fileName: job.fileName || undefined,
      fileSize: job.fileSize || undefined,
      fileFormat: job.fileFormat || undefined,
      errors: job.errors,
      metrics: job.metrics || undefined,
      errorMessage: job.errorMessage || undefined,
      startedAt: job.startedAt || undefined,
      completedAt: job.completedAt || undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
