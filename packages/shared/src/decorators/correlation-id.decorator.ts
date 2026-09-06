import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CORRELATION_ID_HEADER } from '../constants';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/** Reads `x-correlation-id`, minting one when the caller did not supply it. */
export const CorrelationId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<RequestLike>();
  const header = request.headers[CORRELATION_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.length > 0 ? value : randomUUID();
});
