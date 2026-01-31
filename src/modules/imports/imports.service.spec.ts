import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { ImportsService } from './imports.service';
import {
  ImportJob,
  ImportJobStatus,
  ResourceType,
  User,
  Article,
  Comment,
} from '@/database/entities';
import { StorageService } from '@/storage/storage.service';
import { QUEUE_NAMES } from '@/queue/queue.constants';
import { DistributedLockService } from '@/common/services/distributed-lock.service';

describe('ImportsService', () => {
  let service: ImportsService;
  let importJobRepository: jest.Mocked<Repository<ImportJob>>;
  let _userRepository: jest.Mocked<Repository<User>>;
  let _articleRepository: jest.Mocked<Repository<Article>>;
  let _commentRepository: jest.Mocked<Repository<Comment>>;
  let importQueue: jest.Mocked<any>;
  let storageService: jest.Mocked<StorageService>;
  let _configService: jest.Mocked<ConfigService>;
  let _dataSource: jest.Mocked<DataSource>;

  const mockImportJob: Partial<ImportJob> = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: ResourceType.USERS,
    status: ImportJobStatus.PENDING,
    totalRows: 0,
    processedRows: 0,
    successfulRows: 0,
    failedRows: 0,
    skippedRows: 0,
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      find: jest.fn(),
    };

    const mockQueue = {
      add: jest.fn(),
    };

    const mockStorageService = {
      uploadBuffer: jest.fn(),
      uploadStream: jest.fn(),
      getStream: jest.fn(),
      generateImportKey: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          'job.batchSize': 1000,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          create: jest.fn(),
          save: jest.fn(),
          find: jest.fn(),
          findOne: jest.fn(),
          getRepository: jest.fn().mockReturnValue({
            createQueryBuilder: jest.fn().mockReturnValue({
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              getOne: jest.fn(),
            }),
          }),
        },
      }),
    };

    const mockDistributedLockService = {
      getNodeId: jest.fn().mockReturnValue('test-node-1'),
      acquireLock: jest.fn().mockResolvedValue({
        key: 'test-lock',
        token: 'test-token',
        expiresAt: new Date(Date.now() + 300000),
      }),
      releaseLock: jest.fn().mockResolvedValue(true),
      extendLock: jest.fn().mockResolvedValue(true),
      isLocked: jest.fn().mockResolvedValue(false),
      getLockHolder: jest.fn().mockResolvedValue(null),
      withLock: jest.fn().mockImplementation((_key, fn) => fn()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportsService,
        {
          provide: getRepositoryToken(ImportJob),
          useValue: { ...mockRepository },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { ...mockRepository },
        },
        {
          provide: getRepositoryToken(Article),
          useValue: { ...mockRepository },
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: { ...mockRepository },
        },
        {
          provide: getQueueToken(QUEUE_NAMES.IMPORT),
          useValue: mockQueue,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: DistributedLockService,
          useValue: mockDistributedLockService,
        },
      ],
    }).compile();

    service = module.get<ImportsService>(ImportsService);
    importJobRepository = module.get(getRepositoryToken(ImportJob));
    _userRepository = module.get(getRepositoryToken(User));
    _articleRepository = module.get(getRepositoryToken(Article));
    _commentRepository = module.get(getRepositoryToken(Comment));
    importQueue = module.get(getQueueToken(QUEUE_NAMES.IMPORT));
    storageService = module.get(StorageService);
    _configService = module.get(ConfigService);
    _dataSource = module.get(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createImportFromFile', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'users.ndjson',
      encoding: '7bit',
      mimetype: 'application/x-ndjson',
      buffer: Buffer.from('{"email":"test@example.com","name":"Test"}'),
      size: 100,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    it('should create an import job from file upload', async () => {
      const createdJob = { ...mockImportJob };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);
      importJobRepository.findOne.mockResolvedValue(null); // No existing idempotency key
      storageService.generateImportKey.mockReturnValue('imports/2024-01-15/abc123/users.ndjson');
      storageService.uploadBuffer.mockResolvedValue('imports/2024-01-15/abc123/users.ndjson');
      importQueue.add.mockResolvedValue({ id: 'queue-job-1' });

      const result = await service.createImportFromFile(
        mockFile,
        { resourceType: ResourceType.USERS },
        undefined,
      );

      expect(result).toBeDefined();
      expect(result.resourceType).toBe(ResourceType.USERS);
      expect(result.status).toBe(ImportJobStatus.PENDING);
      expect(importJobRepository.create).toHaveBeenCalled();
      expect(importJobRepository.save).toHaveBeenCalled();
      expect(storageService.uploadBuffer).toHaveBeenCalled();
      expect(importQueue.add).toHaveBeenCalled();
    });

    it('should return existing job when idempotency key matches', async () => {
      const existingJob = { ...mockImportJob, idempotencyKey: 'test-key' };
      importJobRepository.findOne.mockResolvedValue(existingJob as ImportJob);

      const result = await service.createImportFromFile(
        mockFile,
        { resourceType: ResourceType.USERS },
        'test-key',
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(existingJob.id);
      expect(importJobRepository.create).not.toHaveBeenCalled();
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
      expect(importQueue.add).not.toHaveBeenCalled();
    });

    it('should detect format from file extension', async () => {
      const csvFile = { ...mockFile, originalname: 'users.csv' };
      const createdJob = { ...mockImportJob, fileFormat: 'csv' };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);
      importJobRepository.findOne.mockResolvedValue(null);
      storageService.generateImportKey.mockReturnValue('imports/2024-01-15/abc123/users.csv');
      storageService.uploadBuffer.mockResolvedValue('imports/2024-01-15/abc123/users.csv');
      importQueue.add.mockResolvedValue({ id: 'queue-job-1' });

      const result = await service.createImportFromFile(
        csvFile,
        { resourceType: ResourceType.USERS },
        undefined,
      );

      expect(result).toBeDefined();
      expect(importJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileFormat: 'csv',
        }),
      );
    });
  });

  describe('createImportFromUrl', () => {
    it('should create an import job from URL', async () => {
      const createdJob = { ...mockImportJob, fileUrl: 'https://example.com/users.ndjson' };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);
      importJobRepository.findOne.mockResolvedValue(null);
      importQueue.add.mockResolvedValue({ id: 'queue-job-1' });

      const result = await service.createImportFromUrl(
        {
          resourceType: ResourceType.USERS,
          fileUrl: 'https://example.com/users.ndjson',
        },
        undefined,
      );

      expect(result).toBeDefined();
      expect(result.resourceType).toBe(ResourceType.USERS);
      expect(importJobRepository.create).toHaveBeenCalled();
      expect(importQueue.add).toHaveBeenCalled();
    });

    it('should throw error when fileUrl is missing', async () => {
      await expect(
        service.createImportFromUrl(
          {
            resourceType: ResourceType.USERS,
            fileUrl: undefined,
          },
          undefined,
        ),
      ).rejects.toThrow('fileUrl is required');
    });
  });

  describe('getJob', () => {
    it('should return job when found', async () => {
      importJobRepository.findOne.mockResolvedValue(mockImportJob as ImportJob);

      const result = await service.getJob(mockImportJob.id!);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockImportJob.id);
      expect(importJobRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockImportJob.id },
      });
    });

    it('should throw NotFoundException when job not found', async () => {
      importJobRepository.findOne.mockResolvedValue(null);

      await expect(service.getJob('non-existent-id')).rejects.toThrow('not found');
    });
  });

  describe('findByIdempotencyKey', () => {
    it('should return job when idempotency key matches', async () => {
      const jobWithKey = { ...mockImportJob, idempotencyKey: 'unique-key' };
      importJobRepository.findOne.mockResolvedValue(jobWithKey as ImportJob);

      const result = await service.findByIdempotencyKey('unique-key');

      expect(result).toBeDefined();
      expect(result?.idempotencyKey).toBe('unique-key');
      expect(importJobRepository.findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: 'unique-key' },
      });
    });

    it('should return null when idempotency key not found', async () => {
      importJobRepository.findOne.mockResolvedValue(null);

      const result = await service.findByIdempotencyKey('non-existent-key');

      expect(result).toBeNull();
    });
  });

  describe('toResponseDto', () => {
    it('should correctly transform ImportJob to response DTO', async () => {
      const job: Partial<ImportJob> = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        resourceType: ResourceType.USERS,
        status: ImportJobStatus.COMPLETED,
        idempotencyKey: 'test-key',
        totalRows: 100,
        processedRows: 100,
        successfulRows: 95,
        failedRows: 5,
        skippedRows: 0,
        errors: [{ row: 10, field: 'email', message: 'Invalid email format' }],
        metrics: {
          rowsPerSecond: 1000,
          errorRate: 0.05,
          durationMs: 100,
        },
        fileName: 'users.ndjson',
        fileSize: 5000,
        fileFormat: 'ndjson',
        startedAt: new Date('2024-01-15T10:00:00Z'),
        completedAt: new Date('2024-01-15T10:00:01Z'),
        createdAt: new Date('2024-01-15T09:59:59Z'),
        updatedAt: new Date('2024-01-15T10:00:01Z'),
      };

      importJobRepository.findOne.mockResolvedValue(job as ImportJob);

      const result = await service.getJob(job.id!);

      expect(result.id).toBe(job.id);
      expect(result.resourceType).toBe(ResourceType.USERS);
      expect(result.status).toBe(ImportJobStatus.COMPLETED);
      expect(result.idempotencyKey).toBe('test-key');
      expect(result.totalRows).toBe(100);
      expect(result.processedRows).toBe(100);
      expect(result.successfulRows).toBe(95);
      expect(result.failedRows).toBe(5);
      expect(result.skippedRows).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].row).toBe(10);
      expect(result.metrics).toBeDefined();
      expect(result.metrics!.rowsPerSecond).toBe(1000);
      expect(result.fileName).toBe('users.ndjson');
      expect(result.fileSize).toBe(5000);
      expect(result.fileFormat).toBe('ndjson');
    });

    it('should handle null optional fields', async () => {
      const job: Partial<ImportJob> = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        resourceType: ResourceType.ARTICLES,
        status: ImportJobStatus.PENDING,
        idempotencyKey: null,
        totalRows: 0,
        processedRows: 0,
        successfulRows: 0,
        failedRows: 0,
        skippedRows: 0,
        errors: [],
        metrics: null,
        fileName: null,
        fileSize: null,
        fileFormat: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      importJobRepository.findOne.mockResolvedValue(job as ImportJob);

      const result = await service.getJob(job.id!);

      expect(result.idempotencyKey).toBeUndefined();
      expect(result.metrics).toBeUndefined();
      expect(result.fileName).toBeUndefined();
      expect(result.fileSize).toBeUndefined();
      expect(result.fileFormat).toBeUndefined();
      expect(result.startedAt).toBeUndefined();
      expect(result.completedAt).toBeUndefined();
    });
  });

  describe('format detection', () => {
    it('should detect ndjson format', async () => {
      const ndjsonFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'data.ndjson',
        encoding: '7bit',
        mimetype: 'application/x-ndjson',
        buffer: Buffer.from('{}'),
        size: 10,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const createdJob = { ...mockImportJob };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);
      importJobRepository.findOne.mockResolvedValue(null);
      storageService.generateImportKey.mockReturnValue('key');
      storageService.uploadBuffer.mockResolvedValue('key');
      importQueue.add.mockResolvedValue({ id: '1' });

      await service.createImportFromFile(
        ndjsonFile,
        { resourceType: ResourceType.USERS },
        undefined,
      );

      expect(importJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileFormat: 'ndjson',
        }),
      );
    });

    it('should detect jsonl format as ndjson', async () => {
      const jsonlFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'data.jsonl',
        encoding: '7bit',
        mimetype: 'application/x-ndjson',
        buffer: Buffer.from('{}'),
        size: 10,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const createdJob = { ...mockImportJob };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);
      importJobRepository.findOne.mockResolvedValue(null);
      storageService.generateImportKey.mockReturnValue('key');
      storageService.uploadBuffer.mockResolvedValue('key');
      importQueue.add.mockResolvedValue({ id: '1' });

      await service.createImportFromFile(
        jsonlFile,
        { resourceType: ResourceType.USERS },
        undefined,
      );

      expect(importJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileFormat: 'ndjson',
        }),
      );
    });

    it('should detect csv format', async () => {
      const csvFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'data.csv',
        encoding: '7bit',
        mimetype: 'text/csv',
        buffer: Buffer.from('a,b,c'),
        size: 10,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const createdJob = { ...mockImportJob };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);
      importJobRepository.findOne.mockResolvedValue(null);
      storageService.generateImportKey.mockReturnValue('key');
      storageService.uploadBuffer.mockResolvedValue('key');
      importQueue.add.mockResolvedValue({ id: '1' });

      await service.createImportFromFile(csvFile, { resourceType: ResourceType.USERS }, undefined);

      expect(importJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileFormat: 'csv',
        }),
      );
    });

    it('should default to json format for unknown extensions', async () => {
      const unknownFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'data.unknown',
        encoding: '7bit',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from('{}'),
        size: 10,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const createdJob = { ...mockImportJob };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);
      importJobRepository.findOne.mockResolvedValue(null);
      storageService.generateImportKey.mockReturnValue('key');
      storageService.uploadBuffer.mockResolvedValue('key');
      importQueue.add.mockResolvedValue({ id: '1' });

      await service.createImportFromFile(
        unknownFile,
        { resourceType: ResourceType.USERS },
        undefined,
      );

      expect(importJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileFormat: 'json',
        }),
      );
    });
  });

  describe('resource types', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'data.ndjson',
      encoding: '7bit',
      mimetype: 'application/x-ndjson',
      buffer: Buffer.from('{}'),
      size: 10,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    beforeEach(() => {
      importJobRepository.findOne.mockResolvedValue(null);
      storageService.generateImportKey.mockReturnValue('key');
      storageService.uploadBuffer.mockResolvedValue('key');
      importQueue.add.mockResolvedValue({ id: '1' });
    });

    it('should accept users resource type', async () => {
      const createdJob = { ...mockImportJob, resourceType: ResourceType.USERS };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);

      const result = await service.createImportFromFile(
        mockFile,
        { resourceType: ResourceType.USERS },
        undefined,
      );

      expect(result.resourceType).toBe(ResourceType.USERS);
    });

    it('should accept articles resource type', async () => {
      const createdJob = { ...mockImportJob, resourceType: ResourceType.ARTICLES };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);

      const result = await service.createImportFromFile(
        mockFile,
        { resourceType: ResourceType.ARTICLES },
        undefined,
      );

      expect(result.resourceType).toBe(ResourceType.ARTICLES);
    });

    it('should accept comments resource type', async () => {
      const createdJob = { ...mockImportJob, resourceType: ResourceType.COMMENTS };
      importJobRepository.create.mockReturnValue(createdJob as ImportJob);
      importJobRepository.save.mockResolvedValue(createdJob as ImportJob);

      const result = await service.createImportFromFile(
        mockFile,
        { resourceType: ResourceType.COMMENTS },
        undefined,
      );

      expect(result.resourceType).toBe(ResourceType.COMMENTS);
    });
  });
});
