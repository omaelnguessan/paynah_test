import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  Throttle,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { RateLimitExceededException } from '../exceptions/app.exception';

export interface ThrottlerSettings {
  /** Window length in milliseconds. */
  ttlMs: number;
  /** Requests allowed per window on an ordinary route. */
  limit: number;
  /** Requests allowed per window on a route that creates or moves something. */
  strictLimit: number;
  /** Budget for an authenticated upstream service, which legitimately bursts. */
  internalLimit: number;
}

export function throttlerSettingsFrom(env: Record<string, unknown>): ThrottlerSettings {
  return {
    ttlMs: Number(env.RATE_LIMIT_TTL_MS ?? 60_000),
    limit: Number(env.RATE_LIMIT_LIMIT ?? 120),
    strictLimit: Number(env.RATE_LIMIT_STRICT_LIMIT ?? 20),
    internalLimit: Number(env.RATE_LIMIT_INTERNAL_LIMIT ?? 1_200),
  };
}

/** One window for the whole API; individual routes tighten it with `StrictThrottle`. */
export function platformThrottlerOptions(settings: ThrottlerSettings): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: 'default', ttl: settings.ttlMs, limit: settings.limit }],
  };
}

/**
 * The budget for a route that creates a resource or moves money. A decorator
 * rather than a second named throttler, because a named throttler applies to
 * every route unless each one opts out — the wrong default for a rule that
 * concerns four endpoints.
 */
export function StrictThrottle(): MethodDecorator {
  // Resolved per request rather than at import time, so the budget follows the
  // environment the process actually booted with.
  return Throttle({
    default: {
      limit: () => throttlerSettingsFrom(process.env).strictLimit,
      ttl: () => throttlerSettingsFrom(process.env).ttlMs,
    },
  });
}

/**
 * The budget for a route only another service calls. It is deliberately wide:
 * the saga makes two or three movements per payment, so a public-facing ceiling
 * here would throttle the platform's own traffic long before it stopped anyone.
 * The counter is still per credential, so a leaked key cannot become a firehose.
 */
export function InternalThrottle(): MethodDecorator {
  return Throttle({
    default: {
      limit: () => throttlerSettingsFrom(process.env).internalLimit,
      ttl: () => throttlerSettingsFrom(process.env).ttlMs,
    },
  });
}

interface RequestLike {
  ip?: string;
  ips?: string[];
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  header(name: string, value: string): void;
}

/**
 * The platform's rate limiter.
 *
 * Two things are changed from the stock guard. A rejection leaves through the
 * envelope like every other failure, so a client parses one shape whatever goes
 * wrong. And the counter is keyed on the internal API key when the caller
 * presents one — a single upstream service must not share a bucket with the
 * public internet just because it happens to sit behind the same address.
 */
@Injectable()
export class EnvelopeThrottlerGuard extends ThrottlerGuard {
  /**
   * A global guard sees every execution context, and `transactions` consumes
   * RabbitMQ messages through the same application. A broker delivery has no
   * client address, no headers and no caller to hold to a budget — and asking
   * it for one used to take the consumer down with a TypeError. Anything that
   * is not HTTP passes straight through; the queue is rate limited by prefetch,
   * which is the broker's job and not this guard's.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<string>() !== 'http') {
      return true;
    }
    return super.canActivate(context);
  }

  protected getTracker(request: RequestLike): Promise<string> {
    const apiKey = request?.headers?.['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      // Not the key itself: a bucket name derived from it, so nothing secret
      // reaches a log line or an error path.
      return Promise.resolve(`internal:${fingerprint(apiKey)}`);
    }
    return Promise.resolve(request?.ip ?? request?.socket?.remoteAddress ?? 'unknown');
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse<ResponseLike>();
    response.header('Retry-After', String(Math.ceil(detail.ttl / 1000)));
    return Promise.reject(new RateLimitExceededException());
  }
}

/** Short, stable and non-reversible: enough to separate buckets, useless to steal. */
function fingerprint(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}
