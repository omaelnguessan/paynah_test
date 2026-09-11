import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  AllExceptionsFilter,
  applyHttpHardening,
  Queue,
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

  // The queue is the primary intake for movements; HTTP is the fallback.
  // Manual ack, so the handler decides itself whether a message is done with.
  // The app config is inherited for the filter and the logger; the global
  // validation pipe is a no-op here, since the event payload is an interface
  // and the handler validates it explicitly to keep control of the ack.
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL as string],
        queue: Queue.TRANSACTIONS,
        queueOptions: { durable: true },
        noAck: false,
        prefetchCount: 16,
      },
    },
    { inheritAppConfig: true },
  );

  const docsPath = docsEnabled
    ? setupSwagger(app, {
        title: 'Transactions API',
        description: 'Append-only ledger and paginated history',
      })
    : null;

  await app.startAllMicroservices();

  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(
    `transactions listening on :${port} — docs at /${docsPath}, consuming ${Queue.TRANSACTIONS}`,
  );
}

void bootstrap();
