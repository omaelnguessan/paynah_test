import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { AppException, ResponseCode, ResponseMessage } from '@paynad/shared';
import { HttpStatus } from '@nestjs/common';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
}

/**
 * Guards the movement endpoints, which only `payments` is meant to call.
 * `/users` and `/accounts` stay public.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);
  private readonly expectedKey: Buffer;
  private readonly expectedSecret: Buffer;

  constructor(config: ConfigService) {
    this.expectedKey = Buffer.from(config.getOrThrow<string>('INTERNAL_API_KEY'), 'utf8');
    this.expectedSecret = Buffer.from(config.getOrThrow<string>('INTERNAL_API_SECRET'), 'utf8');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const key = this.header(request, 'x-api-key');
    const secret = this.header(request, 'x-api-secret');

    // Both comparisons always run, so a valid key with a wrong secret costs the
    // same as the reverse and the failure reveals nothing about which half matched.
    const keyMatches = this.matches(key, this.expectedKey);
    const secretMatches = this.matches(secret, this.expectedSecret);

    if (!keyMatches || !secretMatches) {
      this.logger.warn(`rejected internal call ${request.method} ${request.url}`);
      throw new UnauthorizedInternalCallException();
    }
    return true;
  }

  private header(request: RequestLike, name: string): string {
    const value = request.headers[name];
    const single = Array.isArray(value) ? value[0] : value;
    return single ?? '';
  }

  /**
   * `timingSafeEqual` throws on a length mismatch, which would itself leak the
   * expected length — so the candidate is compared against a same-length buffer
   * and the length difference is folded into the result instead.
   */
  private matches(candidate: string, expected: Buffer): boolean {
    const received = Buffer.from(candidate, 'utf8');
    const padded = Buffer.alloc(expected.length);
    received.copy(padded);
    return timingSafeEqual(padded, expected) && received.length === expected.length;
  }
}

/**
 * Deliberately indistinguishable from any other rejection: an unauthenticated
 * caller learns only that the credentials were refused.
 */
class UnauthorizedInternalCallException extends AppException {
  constructor() {
    super(ResponseCode.VALIDATION_FAILED, ResponseMessage.VALIDATION_FAILED, HttpStatus.UNAUTHORIZED);
  }
}
