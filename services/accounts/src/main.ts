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
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const docsPath = docsEnabled
    ? setupSwagger(app, {
        title: 'Accounts API',
        description: 'Users, wallets and balance movements',
      })
    : null;

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(
    `accounts listening on :${port}` + (docsPath ? ` — docs at /${docsPath}` : ' — docs disabled'),
  );
}

void bootstrap();
