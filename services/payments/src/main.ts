import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import {
  AllExceptionsFilter,
  applyHttpHardening,
  ResponseInterceptor,
  createValidationPipe,
  setupSwagger,
} from '@paynad/shared';
import { AppModule } from './app.module';
import { DomainErrorFilter } from './presentation/filters/domain-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Swagger is opt-in in production.
  const docsEnabled =
    process.env.SWAGGER_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
  applyHttpHardening(app, {
    docsEnabled,
    corsOrigins: process.env.CORS_ORIGINS,
    trustProxy: process.env.TRUST_PROXY,
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseInterceptor());
  // Order matters: the last filter registered is tried first, so a domain
  // failure is mapped by name and everything else falls through to the catch-all.
  app.useGlobalFilters(new AllExceptionsFilter(), new DomainErrorFilter());
  app.enableShutdownHooks();

  const docsPath = docsEnabled
    ? setupSwagger(app, {
        title: 'Payments API',
        description: 'Payment orchestration saga — clean architecture and CQRS',
      })
    : null;

  const port = Number(process.env.PORT ?? 3003);
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(
    `payments listening on :${port}` + (docsPath ? ` — docs at /${docsPath}` : ' — docs disabled'),
  );
}

void bootstrap();
