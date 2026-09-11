import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Currency, WalletStatus } from '@paynad/shared';
import { Wallet } from '../entities/wallet.entity';

/** Outcome of an atomic balance move, before the ledger row is written. */
export interface BalanceMoveResult {
  applied: boolean;
  balance_after: number;
}

@Injectable()
export class WalletRepository {
  constructor(@InjectRepository(Wallet) private readonly wallets: Repository<Wallet>) {}

  private scope(manager?: EntityManager): Repository<Wallet> {
    return manager ? manager.getRepository(Wallet) : this.wallets;
  }

  create(wallet: Partial<Wallet>, manager?: EntityManager): Promise<Wallet> {
    const repository = this.scope(manager);
    return repository.save(repository.create(wallet));
  }

  findByReference(reference: string, manager?: EntityManager): Promise<Wallet | null> {
    return this.scope(manager).findOne({ where: { reference } });
  }

  findByReferenceWithUser(reference: string): Promise<Wallet | null> {
    return this.wallets.findOne({ where: { reference }, relations: { user: true } });
  }

  /**
   * Updates the balance atomically under currency, status and balance constraints.
   * Returns applied=false when a constraint rejects the movement.
   */
  async move(
    walletId: string,
    delta: number,
    currency: Currency,
    manager: EntityManager,
  ): Promise<BalanceMoveResult> {
    const debiting = delta < 0;
    const query = this.scope(manager)
      .createQueryBuilder()
      .update(Wallet)
      .set({
        balance: () => 'balance + :delta',
        updated_at: () => 'now()',
      })
      .setParameter('delta', delta)
      .where('id = :walletId', { walletId })
      .andWhere('status = :status', { status: WalletStatus.ACTIVE })
      .andWhere('currency = :currency', { currency });

    if (debiting) {
      // Never let the available balance go negative, whoever else is writing.
      query.andWhere('balance - reserved_amount >= :required', { required: -delta });
    }

    const result = await query.returning('balance').execute();
    const rows = result.raw as Array<{ balance: string }>;

    return result.affected === 1 && rows.length === 1
      ? { applied: true, balance_after: Number(rows[0].balance) }
      : { applied: false, balance_after: 0 };
  }
}
