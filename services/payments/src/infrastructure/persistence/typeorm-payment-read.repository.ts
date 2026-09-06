import { Injectable } from '@nestjs/common';
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

/** `bigint` arrives as a string from the driver; the view model normalises it. */
function toView(row: PaymentReadModel): PaymentView {
  return { ...row, amount: Number(row.amount) };
}
