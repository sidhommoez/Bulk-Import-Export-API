import { Transform, Readable, TransformCallback } from 'stream';

/**
 * Creates a transform stream that batches items
 */
export class BatchTransform<T> extends Transform {
  private batch: T[] = [];
  private readonly batchSize: number;

  constructor(batchSize: number) {
    super({ objectMode: true });
    this.batchSize = batchSize;
  }

  _transform(chunk: T, _encoding: string, callback: TransformCallback): void {
    this.batch.push(chunk);

    if (this.batch.length >= this.batchSize) {
      this.push(this.batch);
      this.batch = [];
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.batch.length > 0) {
      this.push(this.batch);
    }
    callback();
  }
}

/**
 * Creates a transform stream that converts objects to NDJSON lines
 */
export class NdjsonStringifyTransform extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  _transform(chunk: unknown, _encoding: string, callback: TransformCallback): void {
    try {
      const line = JSON.stringify(chunk) + '\n';
      callback(null, line);
    } catch (error) {
      callback(error as Error);
    }
  }
}

/**
 * Creates a transform stream that parses NDJSON lines
 */
export class NdjsonParseTransform extends Transform {
  private buffer = '';
  private lineNumber = 0;

  constructor() {
    super({ objectMode: true });
  }

  _transform(chunk: Buffer | string, _encoding: string, callback: TransformCallback): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.lineNumber++;
      const trimmed = line.trim();

      if (trimmed === '') continue;

      try {
        const parsed = JSON.parse(trimmed);
        this.push({ data: parsed, lineNumber: this.lineNumber });
      } catch (error) {
        this.push({
          error: `Invalid JSON at line ${this.lineNumber}: ${(error as Error).message}`,
          lineNumber: this.lineNumber,
          raw: trimmed,
        });
      }
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer.trim()) {
      this.lineNumber++;
      try {
        const parsed = JSON.parse(this.buffer.trim());
        this.push({ data: parsed, lineNumber: this.lineNumber });
      } catch (error) {
        this.push({
          error: `Invalid JSON at line ${this.lineNumber}: ${(error as Error).message}`,
          lineNumber: this.lineNumber,
          raw: this.buffer.trim(),
        });
      }
    }
    callback();
  }
}

/**
 * Creates a transform stream that counts rows and calculates metrics
 */
export class MetricsTransform extends Transform {
  private count = 0;
  private startTime = Date.now();
  private lastLogTime = Date.now();
  private lastLogCount = 0;
  private readonly logIntervalMs: number;
  private readonly onMetrics?: (metrics: StreamMetrics) => void;

  constructor(options?: { logIntervalMs?: number; onMetrics?: (metrics: StreamMetrics) => void }) {
    super({ objectMode: true });
    this.logIntervalMs = options?.logIntervalMs || 5000;
    this.onMetrics = options?.onMetrics;
  }

  _transform(chunk: unknown, _encoding: string, callback: TransformCallback): void {
    this.count++;

    const now = Date.now();
    if (now - this.lastLogTime >= this.logIntervalMs) {
      const elapsedSec = (now - this.lastLogTime) / 1000;
      const rowsInInterval = this.count - this.lastLogCount;
      const rowsPerSecond = Math.round(rowsInInterval / elapsedSec);

      if (this.onMetrics) {
        this.onMetrics({
          totalRows: this.count,
          rowsPerSecond,
          elapsedMs: now - this.startTime,
        });
      }

      this.lastLogTime = now;
      this.lastLogCount = this.count;
    }

    callback(null, chunk);
  }

  _flush(callback: TransformCallback): void {
    const elapsedMs = Date.now() - this.startTime;
    const elapsedSec = elapsedMs / 1000 || 1;
    const avgRowsPerSecond = Math.round(this.count / elapsedSec);

    if (this.onMetrics) {
      this.onMetrics({
        totalRows: this.count,
        rowsPerSecond: avgRowsPerSecond,
        elapsedMs,
        final: true,
      });
    }

    callback();
  }

  getCount(): number {
    return this.count;
  }
}

export interface StreamMetrics {
  totalRows: number;
  rowsPerSecond: number;
  elapsedMs: number;
  final?: boolean;
}

/**
 * Creates a rate-limited transform stream
 */
export class RateLimitTransform extends Transform {
  private count = 0;
  private windowStart = Date.now();
  private readonly rateLimit: number; // rows per second

  constructor(rateLimit: number) {
    super({ objectMode: true });
    this.rateLimit = rateLimit;
  }

  async _transform(chunk: unknown, _encoding: string, callback: TransformCallback): Promise<void> {
    this.count++;

    const elapsed = Date.now() - this.windowStart;
    const expectedTime = (this.count / this.rateLimit) * 1000;

    if (expectedTime > elapsed) {
      const delay = expectedTime - elapsed;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Reset window every second
    if (elapsed >= 1000) {
      this.count = 0;
      this.windowStart = Date.now();
    }

    callback(null, chunk);
  }
}

/**
 * Creates an async iterator from a readable stream
 */
export async function* streamToAsyncIterator<T>(stream: Readable): AsyncGenerator<T> {
  for await (const chunk of stream) {
    yield chunk as T;
  }
}

/**
 * Consumes a stream and collects all data into an array
 */
export async function streamToArray<T>(stream: Readable): Promise<T[]> {
  const result: T[] = [];
  for await (const chunk of stream) {
    result.push(chunk as T);
  }
  return result;
}

/**
 * Creates a readable stream from an async iterable
 */
export function asyncIterableToStream<T>(iterable: AsyncIterable<T>): Readable {
  return Readable.from(iterable);
}

/**
 * Safely destroys a stream with optional error
 */
export function destroyStream(stream: Readable | Transform, error?: Error): void {
  if (!stream.destroyed) {
    stream.destroy(error);
  }
}

/**
 * Wraps pipeline with better error handling
 */
export async function safePipeline(
  source: Readable,
  ...rest: (Transform | NodeJS.WritableStream)[]
): Promise<void> {
  const allStreams = [source, ...rest];

  return new Promise<void>((resolve, reject) => {
    // Connect all streams manually
    let current: NodeJS.ReadableStream = source;
    for (let i = 1; i < allStreams.length; i++) {
      const next = allStreams[i] as NodeJS.WritableStream;
      (current as Readable).pipe(next as Transform);
      current = next as unknown as NodeJS.ReadableStream;
    }

    const lastStream = allStreams[allStreams.length - 1];

    // Handle completion
    (lastStream as NodeJS.WritableStream).on('finish', resolve);

    // Handle errors from any stream
    const handleError = (error: Error) => {
      // Clean up all streams on error
      for (const stream of allStreams) {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          const s = stream as Readable | Transform;
          if (!s.destroyed) {
            s.destroy();
          }
        }
      }
      reject(error);
    };

    for (const stream of allStreams) {
      (stream as Readable).on('error', handleError);
    }
  });
}

/**
 * Creates a transform stream that filters items based on a predicate
 */
export class FilterTransform<T> extends Transform {
  private readonly predicate: (item: T) => boolean;

  constructor(predicate: (item: T) => boolean) {
    super({ objectMode: true });
    this.predicate = predicate;
  }

  _transform(chunk: T, _encoding: string, callback: TransformCallback): void {
    if (this.predicate(chunk)) {
      callback(null, chunk);
    } else {
      callback();
    }
  }
}

/**
 * Creates a transform stream that maps items
 */
export class MapTransform<T, R> extends Transform {
  private readonly mapper: (item: T) => R | Promise<R>;

  constructor(mapper: (item: T) => R | Promise<R>) {
    super({ objectMode: true });
    this.mapper = mapper;
  }

  async _transform(chunk: T, _encoding: string, callback: TransformCallback): Promise<void> {
    try {
      const result = await this.mapper(chunk);
      callback(null, result);
    } catch (error) {
      callback(error as Error);
    }
  }
}

/**
 * Creates a pass-through stream that counts bytes
 */
export class ByteCountTransform extends Transform {
  private bytes = 0;

  constructor() {
    super();
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.bytes += chunk.length;
    callback(null, chunk);
  }

  getBytes(): number {
    return this.bytes;
  }
}

/**
 * Memory-efficient line reader for large files
 */
export class LineReaderTransform extends Transform {
  private buffer = '';
  private lineNumber = 0;

  constructor() {
    super({ objectMode: true });
  }

  _transform(chunk: Buffer | string, _encoding: string, callback: TransformCallback): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.lineNumber++;
      this.push({ line, lineNumber: this.lineNumber });
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer) {
      this.lineNumber++;
      this.push({ line: this.buffer, lineNumber: this.lineNumber });
    }
    callback();
  }
}
