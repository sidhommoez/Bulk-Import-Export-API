import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';

export enum ImportJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum ResourceType {
  USERS = 'users',
  ARTICLES = 'articles',
  COMMENTS = 'comments',
}

export interface ImportJobError {
  row: number;
  field?: string;
  message: string;
  value?: unknown;
}

export interface ImportJobMetrics {
  rowsPerSecond: number;
  errorRate: number;
  durationMs: number;
  peakMemoryMB?: number;
}

@Entity('import_jobs')
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true, unique: true })
  @Index('idx_import_jobs_idempotency_key', { unique: true })
  idempotencyKey: string | null;

  @Column({
    name: 'resource_type',
    type: 'enum',
    enum: ResourceType,
  })
  @Index('idx_import_jobs_resource_type')
  resourceType: ResourceType;

  @Column({
    type: 'enum',
    enum: ImportJobStatus,
    default: ImportJobStatus.PENDING,
  })
  @Index('idx_import_jobs_status')
  status: ImportJobStatus;

  @Column({ name: 'file_url', type: 'varchar', length: 2048, nullable: true })
  fileUrl: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: number | null;

  @Column({ name: 'file_format', type: 'varchar', length: 20, nullable: true })
  fileFormat: string | null;

  @Column({ name: 'total_rows', type: 'integer', default: 0 })
  totalRows: number;

  @Column({ name: 'processed_rows', type: 'integer', default: 0 })
  processedRows: number;

  @Column({ name: 'successful_rows', type: 'integer', default: 0 })
  successfulRows: number;

  @Column({ name: 'failed_rows', type: 'integer', default: 0 })
  failedRows: number;

  @Column({ name: 'skipped_rows', type: 'integer', default: 0 })
  skippedRows: number;

  @Column({ type: 'jsonb', default: [] })
  errors: ImportJobError[];

  @Column({ type: 'jsonb', nullable: true })
  metrics: ImportJobMetrics | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 255, nullable: true })
  @Index('idx_import_jobs_locked_by')
  lockedBy: string | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn()
  version: number;

  // Helper method to calculate progress percentage
  get progressPercentage(): number {
    if (this.totalRows === 0) return 0;
    return Math.round((this.processedRows / this.totalRows) * 100);
  }

  // Helper method to check if job is in a terminal state
  get isTerminal(): boolean {
    return [ImportJobStatus.COMPLETED, ImportJobStatus.FAILED, ImportJobStatus.CANCELLED].includes(
      this.status,
    );
  }
}
