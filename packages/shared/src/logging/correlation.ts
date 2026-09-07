import { CORRELATION_ID_HEADER } from '../constants';

export interface HeadersCarrier {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * A correlation id is echoed back in a response header, forwarded on every
 * outbound call and written into every log line, so it is attacker-controlled
 * data that travels far. It is therefore constrained rather than trusted:
 * printable, hyphen-or-alphanumeric, and short enough that no header grows
 * unbounded. Anything else is not repaired — a fresh id is minted instead.
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
