import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface PresignedUrlOptions {
  expiresIn?: number; // seconds
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('aws.region', 'us-east-1');
    const accessKeyId = this.configService.get<string>('aws.accessKeyId', 'test');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey', 'test');
    const endpoint = this.configService.get<string>('aws.s3.endpoint');
    const forcePathStyle = this.configService.get<boolean>('aws.s3.forcePathStyle', false);

    this.bucket = this.configService.get<string>('aws.s3.bucket', 'bulk-import-export');

    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      endpoint: endpoint || undefined,
      forcePathStyle: forcePathStyle,
    });

    this.logger.log(`S3 client initialized for bucket: ${this.bucket}`);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Ensures the S3 bucket exists, creates it if not
   */
  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket ${this.bucket} exists`);
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'NotFound' || err.name === 'NoSuchBucket') {
        this.logger.log(`Creating bucket ${this.bucket}`);
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket ${this.bucket} created`);
      } else {
        this.logger.error(`Error checking bucket: ${(error as Error).message}`);
        throw error;
      }
    }
  }

  /**
   * Uploads a file from a buffer
   */
  async uploadBuffer(
    key: string,
    buffer: Buffer,
    options?: UploadOptions,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: options?.contentType || 'application/octet-stream',
      Metadata: options?.metadata,
    });

    await this.s3Client.send(command);
    this.logger.log(`Uploaded buffer to ${key} (${buffer.length} bytes)`);

    return key;
  }

  /**
   * Uploads a file from a stream (for large files)
   */
  async uploadStream(
    key: string,
    stream: Readable,
    options?: UploadOptions,
  ): Promise<{ key: string; size: number }> {
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: options?.contentType || 'application/octet-stream',
        Metadata: options?.metadata,
      },
      queueSize: 4, // Concurrent upload parts
      partSize: 5 * 1024 * 1024, // 5MB per part
    });

    let totalBytes = 0;

    upload.on('httpUploadProgress', (progress) => {
      if (progress.loaded) {
        totalBytes = progress.loaded;
        this.logger.debug(`Upload progress for ${key}: ${totalBytes} bytes`);
      }
    });

    await upload.done();
    this.logger.log(`Uploaded stream to ${key} (${totalBytes} bytes)`);

    return { key, size: totalBytes };
  }

  /**
   * Gets a readable stream for an object
   */
  async getStream(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error(`No body in response for key: ${key}`);
    }

    return response.Body as Readable;
  }

  /**
   * Gets object content as a buffer
   */
  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Deletes an object
   */
  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.s3Client.send(command);
    this.logger.log(`Deleted ${key}`);
  }

  /**
   * Checks if an object exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Gets object metadata
   */
  async getMetadata(key: string): Promise<StorageObject | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      return {
        key,
        size: response.ContentLength || 0,
        lastModified: response.LastModified || new Date(),
        contentType: response.ContentType,
      };
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Generates a presigned URL for downloading
   */
  async getPresignedDownloadUrl(
    key: string,
    options?: PresignedUrlOptions,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const expiresIn = options?.expiresIn || 3600; // Default 1 hour

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });
    this.logger.debug(`Generated presigned download URL for ${key}`);

    return url;
  }

  /**
   * Generates a presigned URL for uploading
   */
  async getPresignedUploadUrl(
    key: string,
    contentType?: string,
    options?: PresignedUrlOptions,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    });

    const expiresIn = options?.expiresIn || 3600; // Default 1 hour

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });
    this.logger.debug(`Generated presigned upload URL for ${key}`);

    return url;
  }

  /**
   * Lists objects with a given prefix
   */
  async listObjects(prefix: string): Promise<StorageObject[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const response = await this.s3Client.send(command);

    return (response.Contents || []).map((obj) => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      lastModified: obj.LastModified || new Date(),
    }));
  }

  /**
   * Generates a unique key for imports
   */
  generateImportKey(jobId: string, fileName: string): string {
    const date = new Date().toISOString().split('T')[0];
    const extension = fileName.split('.').pop() || 'dat';
    return `imports/${date}/${jobId}/${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}.${extension}`;
  }

  /**
   * Generates a unique key for exports
   */
  generateExportKey(jobId: string, format: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `exports/${date}/${jobId}/export.${format}`;
  }

  /**
   * Gets the bucket name
   */
  getBucket(): string {
    return this.bucket;
  }
}
