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

/** Applies the stricter budget only to decorated routes. */
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

/** Higher request budget for internal service calls, keyed by credential. */
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

/** Returns rate-limit errors in the API envelope and groups internal calls by credential. */
@Injectable()
export class EnvelopeThrottlerGuard extends ThrottlerGuard {
  /** Skips non-HTTP contexts. RabbitMQ delivery is limited separately by prefetch. */
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
