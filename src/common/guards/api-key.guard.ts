import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly apiKeys: Set<string>;
  private readonly headerName = 'x-api-key';

  constructor(private readonly configService: ConfigService) {
    const apiKeyConfig = this.configService.get<string>('app.apiKey', '');
    // Support multiple comma-separated API keys
    this.apiKeys = new Set(
      apiKeyConfig
        .split(',')
        .map((key) => key.trim())
        .filter((key) => key.length > 0),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    // If no API keys are configured, skip authentication (development mode)
    if (this.apiKeys.size === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedApiKey = request.headers[this.headerName] as string;

    if (!providedApiKey) {
      throw new UnauthorizedException('API key is required. Provide it in the X-API-Key header.');
    }

    if (!this.apiKeys.has(providedApiKey)) {
      throw new UnauthorizedException('Invalid API key.');
    }

    return true;
  }
}
