import { DynamicModule } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoggerModule, Params } from 'nestjs-pino';
import { CORRELATION_ID_HEADER } from '../constants';
import { correlationIdOf, HeadersCarrier } from './correlation';

export interface PlatformLoggerOptions {
  serviceName: string;
  level?: string;
  /** Pretty output is for a terminal; containers ship JSON. */
  pretty?: boolean;
}

/** Shared structured logger with service_name and correlation_id. */
export function platformLoggerParams(options: PlatformLoggerOptions): Params {
  const level = options.level ?? process.env.LOG_LEVEL ?? 'info';

  return {
    pinoHttp: {
      level,
      base: { service_name: options.serviceName },
      genReqId: (request) => correlationIdOf(request as unknown as HeadersCarrier, randomUUID),
      customProps: (request) => ({
        correlation_id: (request as unknown as { id?: string }).id,
      }),
      customAttributeKeys: { req: 'request', res: 'response', responseTime: 'duration_ms' },
      // Health probes would otherwise drown the useful lines.
      autoLogging: {
        ignore: (request) => (request as unknown as { url?: string }).url === '/health',
      },
      redact: {
        paths: [
          'request.headers["x-api-key"]',
          'request.headers["x-api-secret"]',
          'request.headers.authorization',
        ],
        censor: '[redacted]',
      },
      transport: options.pretty
        ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
        : undefined,
    },
  };
}

export function PlatformLoggerModule(options: PlatformLoggerOptions): DynamicModule {
  return LoggerModule.forRoot(platformLoggerParams(options));
}

export { CORRELATION_ID_HEADER };
