import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyRepository,
  IdempotencyStatus,
} from '../../domain/ports/idempotency.repository';
import {
  IdempotencyConflictError,
  RequestInProgressError,
} from '../../domain/errors/payment.errors';

export interface IdempotentOutcome<T> {
  result: T;
  replayed: boolean;
}

/**
 * Insert first, ask questions second.
 *
 * A `SELECT` followed by an `INSERT` would let two concurrent requests both
 * decide the key is free. Claiming the key with an insert makes the unique
 * constraint the arbiter, and the loser then reads what the winner recorded.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly keys: IdempotencyRepository,
  ) {}

  /** Stable hash of the payload, so the same key with a different body is caught. */
  static hash(payload: unknown): string {
    return createHash('sha256').update(canonicalise(payload)).digest('hex');
  }

  async execute<T extends Record<string, unknown>>(
    key: string,
    payload: unknown,
    work: () => Promise<{ result: T; paymentReference: string }>,
  ): Promise<IdempotentOutcome<T>> {
    const requestHash = IdempotencyService.hash(payload);

    if (!(await this.keys.claim(key, requestHash))) {
      return { result: await this.resolveExisting(key, requestHash), replayed: true };
    }

    try {
      const { result, paymentReference } = await work();
      await this.keys.complete(key, paymentReference, result);
      return { result, replayed: false };
    } catch (error) {
      // Nothing was recorded, so the claim must not outlive the attempt —
      // otherwise a transient failure would lock the key out for good.
      await this.keys.release(key);
      throw error;
    }
  }

  private async resolveExisting<T>(key: string, requestHash: string): Promise<T> {
    const existing = await this.keys.find(key);
    if (!existing) {
      // The claim was released between the failed insert and this read: the
      // first attempt failed, so the caller is free to try again.
      throw new RequestInProgressError(key);
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError(key);
    }
    if (existing.status === IdempotencyStatus.IN_PROGRESS) {
      throw new RequestInProgressError(key);
    }
    this.logger.log({ transaction_id: key }, 'replaying a completed request');
    return existing.responseBody as T;
  }
}

/** Key order must not change the hash, or a reordered JSON body would look new. */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entry]) => `${JSON.stringify(name)}:${canonicalise(entry)}`);
  return `{${entries.join(',')}}`;
}
