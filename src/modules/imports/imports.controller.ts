import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  HttpStatus,
  HttpCode,
  BadRequestException,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiHeader,
  ApiSecurity,
} from '@nestjs/swagger';
import { ImportsService } from './imports.service';
import {
  CreateImportDto,
  CreateImportFromFileDto,
  ImportJobResponseDto,
} from './dto/create-import.dto';
import { ResourceType } from '@/database/entities';
import { isValidIdempotencyKey } from '@/common/decorators/idempotency-key.decorator';
import { ApiKeyGuard } from '@/common/guards/api-key.guard';

@ApiTags('Imports')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max
      },
      fileFilter: (_req, file, callback) => {
        const allowedMimes = [
          'application/json',
          'application/x-ndjson',
          'text/csv',
          'text/plain',
          'application/octet-stream',
        ];
        const allowedExtensions = ['json', 'ndjson', 'jsonl', 'csv'];
        const ext = file.originalname.split('.').pop()?.toLowerCase();

        if (allowedMimes.includes(file.mimetype) || (ext && allowedExtensions.includes(ext))) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException(
              `Invalid file type. Allowed extensions: ${allowedExtensions.join(', ')}`,
            ),
            false,
          );
        }
      },
    }),
  )
  @ApiOperation({
    summary: 'Create a new import job',
    description:
      'Accepts file upload (multipart) or JSON body with a remote file URL. Use Idempotency-Key header to avoid duplicate processing.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Unique key to prevent duplicate processing. Use a UUID or any unique string.',
    required: false,
    schema: {
      type: 'string',
      default: crypto.randomUUID(),
      example: 'import-users-2024-01-15-abc123',
    },
  })
  @ApiBody({
    description: 'Import request with file upload or URL',
    schema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          enum: Object.values(ResourceType),
          description: 'The type of resource to import',
          example: 'users',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to import (JSON, NDJSON, or CSV)',
        },
        fileUrl: {
          type: 'string',
          description: 'URL of the remote file to import (alternative to file upload)',
          example: 'https://example.com/data/users.ndjson',
        },
        format: {
          type: 'string',
          enum: ['json', 'ndjson', 'csv'],
          description: 'File format (auto-detected if not provided)',
          example: 'ndjson',
        },
      },
      required: ['resourceType'],
    },
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Import job created successfully',
    type: ImportJobResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request (missing file/URL, invalid format, etc.)',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Idempotency key already used for a different request',
  })
  async createImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: CreateImportDto | CreateImportFromFileDto,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<ImportJobResponseDto> {
    // Validate idempotency key if provided
    if (idempotencyKey && !isValidIdempotencyKey(idempotencyKey)) {
      throw new BadRequestException(
        'Invalid Idempotency-Key format. Must be alphanumeric with hyphens/underscores, max 255 chars.',
      );
    }

    // Determine if this is a file upload or URL-based import
    if (file) {
      // File upload
      return this.importsService.createImportFromFile(
        file,
        {
          resourceType: body.resourceType,
          format: 'format' in body ? body.format : undefined,
        },
        idempotencyKey,
      );
    } else if ('fileUrl' in body && body.fileUrl) {
      // URL-based import
      return this.importsService.createImportFromUrl(body as CreateImportDto, idempotencyKey);
    } else {
      throw new BadRequestException('Either file upload or fileUrl is required');
    }
  }

  @Get(':jobId')
  @ApiOperation({
    summary: 'Get import job status',
    description: 'Returns the current status, progress, counters, and errors for an import job.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Import job UUID',
    type: 'string',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Import job details',
    type: ImportJobResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Import job not found',
  })
  async getImportJob(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<ImportJobResponseDto> {
    return this.importsService.getJob(jobId);
  }
}
