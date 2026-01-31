import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Res,
  ParseUUIDPipe,
  HttpStatus,
  HttpCode,
  Header,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBody,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '@/common/guards/api-key.guard';
import { ExportsService } from './exports.service';
import {
  CreateExportDto,
  ExportJobResponseDto,
  StreamingExportQueryDto,
  ExportFormat,
} from './dto/create-export.dto';
import { ResourceType } from '@/database/entities';

@ApiTags('Exports')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('exports')
export class ExportsController {
  private readonly logger = new Logger(ExportsController.name);

  constructor(private readonly exportsService: ExportsService) {}

  @Get()
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @ApiOperation({
    summary: 'Stream export data',
    description:
      'Streams data directly in the response. Best for smaller datasets or when immediate download is needed.',
  })
  @ApiQuery({
    name: 'resource',
    description: 'The type of resource to export',
    enum: ResourceType,
    required: true,
    example: 'articles',
  })
  @ApiQuery({
    name: 'format',
    description: 'Export format',
    enum: ExportFormat,
    required: false,
    example: 'ndjson',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Streamed export data',
    content: {
      'application/x-ndjson': {
        schema: { type: 'string' },
        example: '{"id":"...","email":"user@example.com",...}\n',
      },
      'application/json': {
        schema: { type: 'array' },
      },
      'text/csv': {
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid resource type or format',
  })
  async streamExport(@Query() query: StreamingExportQueryDto, @Res() res: Response): Promise<void> {
    const format = query.format || ExportFormat.NDJSON;

    const { stream, contentType, fileName } = await this.exportsService.createStreamingExport(
      query.resource,
      format,
    );

    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Pipe the stream to the response
    stream.pipe(res);

    // Handle stream errors
    stream.on('error', (error) => {
      this.logger.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'Error streaming export data',
        });
      }
    });
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create an async export job',
    description:
      'Creates a background export job with optional filters and field selection. Use GET /exports/{job_id} to check status and get download URL.',
  })
  @ApiBody({
    description: 'Export request with filters and options',
    type: CreateExportDto,
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Export job created successfully',
    type: ExportJobResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request parameters',
  })
  async createExport(@Body() dto: CreateExportDto): Promise<ExportJobResponseDto> {
    return this.exportsService.createExport(dto);
  }

  @Get(':jobId')
  @ApiOperation({
    summary: 'Get export job status',
    description:
      'Returns the current status, progress, and download URL (when completed) for an export job.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Export job UUID',
    type: 'string',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Export job details',
    type: ExportJobResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Export job not found',
  })
  async getExportJob(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<ExportJobResponseDto> {
    return this.exportsService.getJob(jobId);
  }
}
