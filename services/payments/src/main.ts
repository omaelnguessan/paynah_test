import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import {
  AllExceptionsFilter,
  ResponseInterceptor,
  createValidationPipe,
  setupSwagger,
} from '@paynad/shared';
import { AppModule } from './app.module';
import { DomainErrorFilter } from './presentation/filters/domain-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseInterceptor());
  // Order matters: the last filter registered is tried first, so a domain
  // failure is mapped by name and everything else falls through to the catch-all.
  app.useGlobalFilters(new AllExceptionsFilter(), new DomainErrorFilter());
  app.enableShutdownHooks();

  const docsPath = setupSwagger(app, {
    title: 'Payments API',
    description: 'Payment orchestration saga — clean architecture and CQRS',
  });

  const port = Number(process.env.PORT ?? 3003);
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`payments listening on :${port} — docs at /${docsPath}`);
}

void bootstrap();
