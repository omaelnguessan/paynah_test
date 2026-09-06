import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { LedgerEntry } from '../entities/ledger-entry.entity';

/**
 * Append-only access: this repository exposes no update and no delete, so the
 * ledger can only ever grow.
 */
@Injectable()
export class LedgerEntryRepository {
  constructor(@InjectRepository(LedgerEntry) private readonly entries: Repository<LedgerEntry>) {}

  private scope(manager?: EntityManager): Repository<LedgerEntry> {
    return manager ? manager.getRepository(LedgerEntry) : this.entries;
  }

  append(entry: Partial<LedgerEntry>, manager?: EntityManager): Promise<LedgerEntry> {
    const repository = this.scope(manager);
    return repository.save(repository.create(entry));
  }

  /** The idempotency lookup: one movement per `(wallet, transaction_id)`. */
  findByIdempotencyKey(
    walletId: string,
    transactionId: string,
    manager?: EntityManager,
  ): Promise<LedgerEntry | null> {
    return this.scope(manager).findOne({
      where: { wallet_id: walletId, transaction_id: transactionId },
    });
  }
}
