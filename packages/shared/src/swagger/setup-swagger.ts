import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiResponse } from '../dto/api-response.dto';

export interface SwaggerOptions {
  title: string;
  description: string;
  version?: string;
  path?: string;
}

export function setupSwagger(app: INestApplication, options: SwaggerOptions): string {
  const path = options.path ?? 'docs';
  const config = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setVersion(options.version ?? '1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiResponse],
  });
  SwaggerModule.setup(path, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
  return path;
}
