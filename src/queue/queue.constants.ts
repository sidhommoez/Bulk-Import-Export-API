export const QUEUE_NAMES = {
  IMPORT: 'import-queue',
  EXPORT: 'export-queue',
} as const;

export const JOB_NAMES = {
  // Import jobs
  PROCESS_IMPORT: 'process-import',
  PROCESS_IMPORT_BATCH: 'process-import-batch',

  // Export jobs
  PROCESS_EXPORT: 'process-export',
  GENERATE_EXPORT_FILE: 'generate-export-file',
} as const;

export const JOB_PRIORITIES = {
  HIGH: 1,
  NORMAL: 5,
  LOW: 10,
} as const;

export interface ImportJobData {
  jobId: string;
  resourceType: string;
  fileUrl?: string;
  filePath?: string;
  fileFormat: string;
  idempotencyKey?: string;
}

export interface ImportBatchJobData {
  jobId: string;
  resourceType: string;
  batch: unknown[];
  batchNumber: number;
  startRow: number;
}

export interface ExportJobData {
  jobId: string;
  resourceType: string;
  format: string;
  filters?: Record<string, unknown>;
  fields?: string[];
}

export interface JobProgress {
  processedRows: number;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  currentBatch?: number;
  totalBatches?: number;
}

export interface JobResult {
  success: boolean;
  processedRows: number;
  successfulRows: number;
  failedRows: number;
  skippedRows: number;
  errors: JobError[];
  metrics: JobMetrics;
}

export interface JobError {
  row: number;
  field?: string;
  message: string;
  value?: unknown;
}

export interface JobMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  rowsPerSecond: number;
  errorRate: number;
  peakMemoryMB?: number;
}
