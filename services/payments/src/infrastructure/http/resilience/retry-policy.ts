/** Retries transient transport failures. Business refusals are not retried. */
const RETRYABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);

export interface FailureShape {
  status?: number;
  code?: string;
  timedOut?: boolean;
}

export function isRetryable(failure: FailureShape): boolean {
  if (failure.timedOut) {
    return true;
  }
  if (failure.code && RETRYABLE_CODES.has(failure.code)) {
    return true;
  }
  if (failure.status === undefined) {
    // No response at all: the request never got an answer, so it may be worth another try.
    return true;
  }
  return failure.status === 429 || failure.status >= 500;
}

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Injected so the schedule is deterministic under test. */
  random?: () => number;
}

/**
 * Exponential backoff with full jitter. Without the jitter, every client that
 * failed at the same moment would come back at the same moment.
 */
export function backoffDelay(attempt: number, options: BackoffOptions): number {
  const exponential = Math.min(options.maxMs, options.baseMs * 2 ** (attempt - 1));
  const random = options.random ?? Math.random;
  return Math.floor(random() * exponential);
}
