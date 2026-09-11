import { ConcurrentPaymentError } from '../../domain/errors/concurrent-payment.error';
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
  private readonly revisions = new WeakMap<Payment, number>();

  constructor(private readonly context: TransactionContext) {}

  private get repository() {
    return this.context.manager.getRepository(PaymentOrmEntity);
  }

  async save(payment: Payment): Promise<void> {
    const row = PaymentOrmMapper.toPersistence(payment);
    const revision = this.revisions.get(payment);
    if (revision === undefined) {
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        .values(row)
        .orIgnore()
        .returning('reference')
        .execute();
      if (!result.raw.length) throw new ConcurrentPaymentError(payment.reference.value);
      this.revisions.set(payment, 1);
      return;
    }
    const { reference, transaction_id: _transactionId, ...changes } = row;
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({ ...changes, version: () => 'version + 1', updated_at: new Date() })
      .where('reference = :reference AND version = :version', { reference, version: revision })
      .execute();
    if (result.affected !== 1) throw new ConcurrentPaymentError(payment.reference.value);
    this.revisions.set(payment, revision + 1);
  }

  private hydrate(row: PaymentOrmEntity): Payment {
    const payment = PaymentOrmMapper.toDomain(row);
    this.revisions.set(payment, row.version);
    return payment;
  }

  async findByReference(reference: Reference): Promise<Payment | null> {
    const row = await this.repository.findOne({ where: { reference: reference.value } });
    return row ? this.hydrate(row) : null;
  }

  async findByTransactionId(transactionId: string): Promise<Payment | null> {
    const row = await this.repository.findOne({ where: { transaction_id: transactionId } });
    return row ? this.hydrate(row) : null;
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
    return rows.map((row) => this.hydrate(row));
  }
}
