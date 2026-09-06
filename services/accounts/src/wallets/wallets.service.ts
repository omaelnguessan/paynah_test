import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  CurrencyMismatchException,
  DeclinedReason,
  IdempotencyConflictException,
  InsufficientBalanceException,
  ReferencePrefix,
  TransactionType,
  WalletFrozenException,
  WalletNotFoundException,
  WalletStatus,
  generateReference,
  isUniqueViolation,
} from '@paynad/shared';
import { UsersService } from '../users/users.service';
import { BalanceOperationRequest } from './dto/balance-operation.request';
import { BalanceOperationResponse } from './dto/balance-operation.response';
import { CreateWalletRequest } from './dto/create-wallet.request';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Wallet } from './entities/wallet.entity';
import { LedgerEntryRepository } from './repositories/ledger-entry.repository';
import { WalletRepository } from './repositories/wallet.repository';

/** A wallet plus the reference of the user it belongs to. */
export interface WalletWithOwner {
  wallet: Wallet;
  user_reference: string;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly wallets: WalletRepository,
    private readonly ledger: LedgerEntryRepository,
    private readonly users: UsersService,
  ) {}

  async create(request: CreateWalletRequest): Promise<WalletWithOwner> {
    const user = await this.users.findByReference(request.user_reference);
    const openingBalance = request.initial_balance ?? 0;
    const reference = generateReference(ReferencePrefix.WALLET);

    const wallet = await this.dataSource.transaction(async (manager) => {
      const created = await this.wallets.create(
        {
          reference,
          user_id: user.id,
          currency: request.currency,
          balance: openingBalance,
          reserved_amount: 0,
          label: request.label ?? null,
          status: WalletStatus.ACTIVE,
        },
        manager,
      );

      // Requirement: no balance exists without a ledger row explaining it.
      if (openingBalance > 0) {
        await this.ledger.append(
          {
            reference: generateReference(ReferencePrefix.TRANSACTION),
            wallet_id: created.id,
            transaction_id: `opening-${reference.replace('_', '-')}`,
            type: TransactionType.CREDIT,
            amount: openingBalance,
            currency: created.currency,
            balance_before: 0,
            balance_after: openingBalance,
            description: 'Opening balance',
            payment_reference: null,
          },
          manager,
        );
      }
      return created;
    });

    return { wallet, user_reference: user.reference };
  }

  async getWithOwner(reference: string): Promise<WalletWithOwner> {
    const wallet = await this.wallets.findByReferenceWithUser(reference);
    if (!wallet) {
      throw new WalletNotFoundException({ reference });
    }
    return { wallet, user_reference: wallet.user.reference };
  }

  credit(reference: string, request: BalanceOperationRequest): Promise<BalanceOperationResponse> {
    return this.applyMovement(reference, request, TransactionType.CREDIT);
  }

  debit(reference: string, request: BalanceOperationRequest): Promise<BalanceOperationResponse> {
    return this.applyMovement(reference, request, TransactionType.DEBIT);
  }

  /**
   * One movement, applied exactly once.
   *
   * The whole thing runs in a single transaction: the balance moves through a
   * conditional UPDATE (so the guard and the write share one row lock) and the
   * ledger row is inserted in the same unit of work. If the unique
   * `(wallet_id, transaction_id)` fires, the transaction rolls back and the
   * movement recorded by the winning caller is returned instead.
   */
  private async applyMovement(
    reference: string,
    request: BalanceOperationRequest,
    type: TransactionType,
  ): Promise<BalanceOperationResponse> {
    const wallet = await this.wallets.findByReference(reference);
    if (!wallet) {
      throw new WalletNotFoundException({ reference });
    }

    const replayed = await this.ledger.findByIdempotencyKey(wallet.id, request.transaction_id);
    if (replayed) {
      return this.replay(replayed, request, type);
    }

    this.assertOperable(wallet, request);

    try {
      return await this.dataSource.transaction(async (manager) =>
        this.applyInTransaction(manager, wallet, request, type),
      );
    } catch (error) {
      if (!isUniqueViolation(error, 'uq_ledger_entries_wallet_transaction')) {
        throw error;
      }
      // A concurrent caller replayed the same key and won the race; the losing
      // transaction rolled back, so no money moved twice.
      this.logger.log(
        `concurrent replay of ${request.transaction_id} on ${reference}, returning the original movement`,
      );
      const original = await this.ledger.findByIdempotencyKey(wallet.id, request.transaction_id);
      if (!original) {
        throw error;
      }
      return this.replay(original, request, type);
    }
  }

  private async applyInTransaction(
    manager: EntityManager,
    wallet: Wallet,
    request: BalanceOperationRequest,
    type: TransactionType,
  ): Promise<BalanceOperationResponse> {
    const delta = type === TransactionType.CREDIT ? request.amount : -request.amount;
    const move = await this.wallets.move(wallet.id, delta, request.currency, manager);

    if (!move.applied) {
      // The conditional UPDATE refused the move. Re-read to say why — this path
      // only ever produces a refusal, never a write.
      const current = await this.wallets.findByReference(wallet.reference, manager);
      if (!current) {
        throw new WalletNotFoundException({ reference: wallet.reference });
      }
      this.assertOperable(current, request);
      throw new InsufficientBalanceException(
        BalanceOperationResponse.declined(
          request,
          current.balance,
          DeclinedReason.INSUFFICIENT_BALANCE,
        ),
      );
    }

    const entry = await this.ledger.append(
      {
        reference: generateReference(ReferencePrefix.TRANSACTION),
        wallet_id: wallet.id,
        transaction_id: request.transaction_id,
        type,
        amount: request.amount,
        currency: request.currency,
        balance_before: move.balance_after - delta,
        balance_after: move.balance_after,
        description: request.description,
        payment_reference: request.payment_reference ?? null,
      },
      manager,
    );

    return BalanceOperationResponse.approved(entry);
  }

  /**
   * A replay returns the original movement byte for byte. Replaying the key
   * with a *different* body is a caller bug, not a retry, and is refused.
   */
  private replay(
    original: LedgerEntry,
    request: BalanceOperationRequest,
    type: TransactionType,
  ): BalanceOperationResponse {
    const sameOperation =
      original.type === type &&
      original.amount === request.amount &&
      original.currency === request.currency;

    if (!sameOperation) {
      throw new IdempotencyConflictException({
        transaction_id: request.transaction_id,
        reference: original.reference,
        recorded_type: original.type,
        recorded_amount: original.amount,
        recorded_currency: original.currency,
      });
    }
    return BalanceOperationResponse.approved(original);
  }

  /** Refusals that do not depend on the balance, so they can be checked early. */
  private assertOperable(wallet: Wallet, request: BalanceOperationRequest): void {
    if (wallet.status === WalletStatus.FROZEN) {
      throw new WalletFrozenException(
        BalanceOperationResponse.declined(request, wallet.balance, DeclinedReason.WALLET_FROZEN),
      );
    }
    if (wallet.currency !== request.currency) {
      throw new CurrencyMismatchException(
        BalanceOperationResponse.declined(
          request,
          wallet.balance,
          DeclinedReason.CURRENCY_MISMATCH,
        ),
      );
    }
  }
}
