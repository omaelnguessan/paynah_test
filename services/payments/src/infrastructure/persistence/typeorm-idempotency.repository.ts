import { Injectable } from '@nestjs/common';
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
    // ON CONFLICT preserves the surrounding transaction; catching a unique
    // violation would leave PostgreSQL's transaction aborted.
    const rows: Array<{ key: string }> = await this.context.manager.query(
      `INSERT INTO idempotency_keys (key, request_hash, status)
       VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [key, requestHash, IdempotencyStatus.IN_PROGRESS],
    );
    return rows.length === 1;
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
}
