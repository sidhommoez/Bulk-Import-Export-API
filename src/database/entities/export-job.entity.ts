import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';
import { ResourceType } from './import-job.entity';

export enum ExportJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum ExportFormat {
  JSON = 'json',
  NDJSON = 'ndjson',
  CSV = 'csv',
}

export interface ExportJobFilters {
  ids?: string[];
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  status?: string;
  active?: boolean;
  authorId?: string;
  articleId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface ExportJobMetrics {
  rowsPerSecond: number;
  totalBytes: number;
  durationMs: number;
  peakMemoryMB?: number;
}

@Entity('export_jobs')
export class ExportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'resource_type',
    type: 'enum',
    enum: ResourceType,
  })
  @Index('idx_export_jobs_resource_type')
  resourceType: ResourceType;

  @Column({
    type: 'enum',
    enum: ExportFormat,
    default: ExportFormat.NDJSON,
  })
  format: ExportFormat;

  @Column({
    type: 'enum',
    enum: ExportJobStatus,
    default: ExportJobStatus.PENDING,
  })
  @Index('idx_export_jobs_status')
  status: ExportJobStatus;

  @Column({ type: 'jsonb', nullable: true })
  filters: ExportJobFilters | null;

  @Column({ type: 'jsonb', nullable: true })
  fields: string[] | null;

  @Column({ name: 'download_url', type: 'varchar', length: 2048, nullable: true })
  downloadUrl: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: number | null;

  @Column({ name: 'total_rows', type: 'integer', default: 0 })
  totalRows: number;

  @Column({ name: 'exported_rows', type: 'integer', default: 0 })
  exportedRows: number;

  @Column({ type: 'jsonb', nullable: true })
  metrics: ExportJobMetrics | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn()
  version: number;

  @Column({ name: 'locked_by', type: 'varchar', length: 255, nullable: true })
  lockedBy: string | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  // Helper method to calculate progress percentage
  get progressPercentage(): number {
    if (this.totalRows === 0) return 0;
    return Math.round((this.exportedRows / this.totalRows) * 100);
  }

  // Helper method to check if job is in a terminal state
  get isTerminal(): boolean {
    return [ExportJobStatus.COMPLETED, ExportJobStatus.FAILED, ExportJobStatus.CANCELLED].includes(
      this.status,
    );
  }

  // Helper method to check if download is expired
  get isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
  }
}
