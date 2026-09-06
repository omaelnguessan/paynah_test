import { Injectable } from '@nestjs/common';
import { LessThan, In } from 'typeorm';
import { Payment } from '../../domain/model/payment';
import { PaymentStatus } from '../../domain/model/payment-status';
import { Reference } from '../../domain/model/reference';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { PaymentOrmEntity } from './entities/payment.orm-entity';
import { PaymentOrmMapper } from './mappers/payment.orm-mapper';
import { TransactionContext } from './transaction-context';

@Injectable()
export class TypeOrmPaymentRepository implements PaymentRepository {
  constructor(private readonly context: TransactionContext) {}

  private get repository() {
    return this.context.manager.getRepository(PaymentOrmEntity);
  }

  /**
   * Upsert on the natural key: the aggregate decides its own reference, so the
   * repository never needs to know whether this is an insert or an update.
   */
  async save(payment: Payment): Promise<void> {
    const row = PaymentOrmMapper.toPersistence(payment);
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(PaymentOrmEntity)
      .values(row)
      .orUpdate(
        [
          'status',
          'failure_reason',
          'debit_transaction_reference',
          'credit_transaction_reference',
          'refund_transaction_reference',
          'completed_at',
          'updated_at',
        ],
        ['reference'],
      )
      .setParameter('now', new Date())
      .execute();
  }

  async findByReference(reference: Reference): Promise<Payment | null> {
    const row = await this.repository.findOne({ where: { reference: reference.value } });
    return row ? PaymentOrmMapper.toDomain(row) : null;
  }

  async findByTransactionId(transactionId: string): Promise<Payment | null> {
    const row = await this.repository.findOne({ where: { transaction_id: transactionId } });
    return row ? PaymentOrmMapper.toDomain(row) : null;
  }

  async findStuck(
    statuses: readonly PaymentStatus[],
    olderThan: Date,
    limit: number,
  ): Promise<Payment[]> {
    const rows = await this.repository.find({
      where: { status: In([...statuses]), updated_at: LessThan(olderThan) },
      order: { updated_at: 'ASC' },
      take: limit,
    });
    return rows.map(PaymentOrmMapper.toDomain);
  }
}
