import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import {
  AllExceptionsFilter,
  ResponseInterceptor,
  createValidationPipe,
  setupSwagger,
} from '@paynad/shared';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const docsPath = setupSwagger(app, {
    title: 'Accounts API',
    description: 'Users, wallets and balance movements',
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`accounts listening on :${port} — docs at /${docsPath}`);
}

void bootstrap();
