import { CORRELATION_ID_HEADER } from '../constants';

export interface HeadersCarrier {
  headers: Record<string, string | string[] | undefined>;
}

/** Reads an inbound correlation id, or mints one when the caller sent none. */
export function correlationIdOf(request: HeadersCarrier, generate: () => string): string {
  const header = request.headers[CORRELATION_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.length > 0 ? value : generate();
}
