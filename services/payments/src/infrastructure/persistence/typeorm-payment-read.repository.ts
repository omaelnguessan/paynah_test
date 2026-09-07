import { Injectable } from '@nestjs/common';
import { Currency } from '../../domain/model/money';
import { FailureReason, PaymentStatus } from '../../domain/model/payment-status';
import {
  PaymentReadPort,
  PaymentView,
  PaymentViewFilter,
} from '../../domain/ports/payment-read.port';
import { PaymentReadModel } from './entities/payment-read-model.orm-entity';
import { TransactionContext } from './transaction-context';

@Injectable()
export class TypeOrmPaymentReadRepository implements PaymentReadPort {
  constructor(private readonly context: TransactionContext) {}

  private get repository() {
    return this.context.manager.getRepository(PaymentReadModel);
  }

  async findByReference(reference: string): Promise<PaymentView | null> {
    const row = await this.repository.findOne({ where: { reference } });
    return row ? toView(row) : null;
  }

  async findPage(filter: PaymentViewFilter): Promise<{ items: PaymentView[]; total: number }> {
    const query = this.repository.createQueryBuilder('p');

    if (filter.status) {
      query.andWhere('p.status = :status', { status: filter.status });
    }
    if (filter.sourceWallet) {
      query.andWhere('p.source_wallet_reference = :wallet', { wallet: filter.sourceWallet });
    }

    const [rows, total] = await query
      .orderBy('p.created_at', 'DESC')
      .addOrderBy('p.reference', 'DESC')
      .skip((filter.page - 1) * filter.perPage)
      .take(filter.perPage)
      .getManyAndCount();

    return { items: rows.map(toView), total };
  }
}

/**
 * The view speaks the database's column names; the port speaks the domain's.
 * Spreading the row used to be enough because both sides happened to use the
 * wire format — which is precisely the coupling this mapper now absorbs.
 */
function toView(row: PaymentReadModel): PaymentView {
  return {
    reference: row.reference,
    transactionId: row.transaction_id,
    // `bigint` arrives as a string from the driver.
    amount: Number(row.amount),
    currency: row.currency as Currency,
    description: row.description,
    sourceWallet: row.source_wallet_reference,
    destinationWallet: row.destination_wallet_reference,
    status: row.status as PaymentStatus,
    failureReason: row.failure_reason as FailureReason | null,
    debitTransactionReference: row.debit_transaction_reference,
    creditTransactionReference: row.credit_transaction_reference,
    refundTransactionReference: row.refund_transaction_reference,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
