import { CORRELATION_ID_HEADER } from '../constants';

export interface HeadersCarrier {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Validates the caller-controlled correlation ID before forwarding or logging it.
 * Invalid or oversized values are replaced with a generated ID.
 */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function isSafeCorrelationId(value: string): boolean {
  return SAFE_CORRELATION_ID.test(value);
}

/** Reads an inbound correlation id, or mints one when the caller sent none. */
export function correlationIdOf(request: HeadersCarrier, generate: () => string): string {
  const header = request.headers[CORRELATION_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value && isSafeCorrelationId(value) ? value : generate();
}
