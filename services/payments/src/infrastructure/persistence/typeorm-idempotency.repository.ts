import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '@paynad/shared';
import {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyStatus,
} from '../../domain/ports/idempotency.repository';
import { IdempotencyKeyOrmEntity } from './entities/idempotency-key.orm-entity';
import { TransactionContext } from './transaction-context';

@Injectable()
export class TypeOrmIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly context: TransactionContext) {}

  private get repository() {
    return this.context.manager.getRepository(IdempotencyKeyOrmEntity);
  }

  /**
   * Insert first. A unique violation is not an error here, it is the answer:
   * somebody else already owns this key.
   */
  async claim(key: string, requestHash: string): Promise<boolean> {
    try {
      await this.repository.insert({
        key,
        request_hash: requestHash,
        status: IdempotencyStatus.IN_PROGRESS,
        payment_reference: null,
        response_body: null,
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async find(key: string): Promise<IdempotencyRecord | null> {
    const row = await this.repository.findOne({ where: { key } });
    return row
      ? {
          key: row.key,
          requestHash: row.request_hash,
          status: row.status as IdempotencyStatus,
          paymentReference: row.payment_reference,
          responseBody: row.response_body as Record<string, unknown> | null,
        }
      : null;
  }

  async complete(
    key: string,
    paymentReference: string,
    responseBody: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.update(
      { key },
      {
        status: IdempotencyStatus.COMPLETED,
        payment_reference: paymentReference,
        response_body: responseBody,
      },
    );
  }

  async release(key: string): Promise<void> {
    await this.repository.delete({ key, status: IdempotencyStatus.IN_PROGRESS });
  }
}
