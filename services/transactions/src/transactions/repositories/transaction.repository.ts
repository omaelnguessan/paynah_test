import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResolvedPagination, TransactionType } from '@paynad/shared';
import { Transaction } from '../entities/transaction.entity';

export interface HistoryFilter {
  user_reference?: string | null;
  wallet_reference?: string | null;
  type?: TransactionType | null;
}

/**
 * Append-only access: no update, no delete, so the ledger can only ever grow.
 */
@Injectable()
export class TransactionRepository {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
  ) {}

  append(transaction: Partial<Transaction>): Promise<Transaction> {
    return this.transactions.save(this.transactions.create(transaction));
  }

  findByTransactionId(transactionId: string): Promise<Transaction | null> {
    return this.transactions.findOne({ where: { transaction_id: transactionId } });
  }

  findByReference(reference: string): Promise<Transaction | null> {
    return this.transactions.findOne({ where: { reference } });
  }

  /**
   * At least one reference filter is always present — the service refuses an
   * unfiltered call — so this query always rides one of the composite indexes.
   */
  async findPage(
    filter: HistoryFilter,
    pagination: ResolvedPagination,
  ): Promise<[Transaction[], number]> {
    const query = this.transactions.createQueryBuilder('t');

    if (filter.wallet_reference) {
      query.andWhere('t.wallet_reference = :wallet', { wallet: filter.wallet_reference });
    }
    if (filter.user_reference) {
      query.andWhere('t.user_reference = :user', { user: filter.user_reference });
    }
    if (filter.type) {
      query.andWhere('t.type = :type', { type: filter.type });
    }

    return query
      .orderBy('t.occurred_at', 'DESC')
      // Tie-breaker: without it two movements sharing a business timestamp could
      // swap places between pages and be shown twice, or not at all.
      .addOrderBy('t.recorded_at', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .skip(pagination.skip)
      .take(pagination.perPage)
      .getManyAndCount();
  }
}
