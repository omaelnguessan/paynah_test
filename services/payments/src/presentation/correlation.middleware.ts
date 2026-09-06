import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CORRELATION_ID_HEADER, correlationIdOf } from '@paynad/shared';
import { CorrelationContext } from '../infrastructure/http/correlation.context';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

/**
 * Establishes the correlation id for the whole request, echoes it back, and
 * makes it ambient — so the saga, the HTTP client and every log line quote the
 * same value without passing it around.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly correlation: CorrelationContext) {}

  use(request: RequestLike, response: ResponseLike, next: () => void): void {
    const correlationId = correlationIdOf(request, randomUUID);
    request.headers[CORRELATION_ID_HEADER] = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    this.correlation.run(correlationId, next);
  }
}
