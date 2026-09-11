import { TransactionContext } from './transaction-context';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource } from 'typeorm';
import { ConcurrentPaymentError } from '../../domain/errors/concurrent-payment.error';
import { PaymentExecution } from '../../domain/ports/payment-execution.port';

/** A dedicated session owns the lock across the saga's separate transactions. */
@Injectable()
export class PostgresPaymentExecution implements PaymentExecution {
  private readonly active = new AsyncLocalStorage<string>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transaction: TransactionContext,
  ) {}

  async run<T>(reference: string, work: () => Promise<T>): Promise<T> {
    // Saga commands join the saga's lock instead of deadlocking themselves.
    if (this.active.getStore() === reference) return work();
    const connection = this.dataSource.createQueryRunner();
    let locked = false;
    try {
      await connection.connect();
      const [result] = await connection.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [`payment:${reference}`],
      );
      locked = result.locked;
      if (!locked) throw new ConcurrentPaymentError(reference);
      return await this.active.run(reference, () =>
        this.transaction.withConnection(connection, work),
      );
    } finally {
      try {
        if (locked)
          await connection.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
            `payment:${reference}`,
          ]);
      } finally {
        await connection.release();
      }
    }
  }
}
