import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  Currency,
  CurrencyMismatchException,
  DeclinedReason,
  IdempotencyConflictException,
  InsufficientBalanceException,
  PG_UNIQUE_VIOLATION,
  TransactionStatus,
  TransactionType,
  WalletFrozenException,
  WalletNotFoundException,
  WalletStatus,
} from '@paynad/shared';
import { UsersService } from '../users/users.service';
import { BalanceOperationRequest } from './dto/balance-operation.request';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Wallet } from './entities/wallet.entity';
import { LedgerEntryRepository } from './repositories/ledger-entry.repository';
import { WalletRepository } from './repositories/wallet.repository';
import { WalletsService } from './wallets.service';

const WALLET_REFERENCE = 'wlt_01hq3m8x0000zt7k9d2v4bqf1c';

function walletFixture(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: 'a5e1b0c8-0000-4000-8000-000000000001',
    reference: WALLET_REFERENCE,
    user_id: 'a5e1b0c8-0000-4000-8000-000000000002',
    currency: Currency.XOF,
    balance: 10_000,
    reserved_amount: 0,
    label: null,
    status: WalletStatus.ACTIVE,
    ...overrides,
  } as Wallet;
}

function requestFixture(overrides: Partial<BalanceOperationRequest> = {}): BalanceOperationRequest {
  return {
    transaction_id: 'tx-00000001',
    amount: 2_500,
    currency: Currency.XOF,
    description: 'Test movement',
    payment_reference: null,
    ...overrides,
  };
}

describe('WalletsService', () => {
  const wallets = {
    findByReference: jest.fn(),
    findByReferenceWithUser: jest.fn(),
    move: jest.fn(),
    create: jest.fn(),
  };
  const ledger = {
    findByIdempotencyKey: jest.fn(),
    append: jest.fn(),
  };
  const users = { findByReference: jest.fn() };
  const manager = {} as EntityManager;
  const dataSource = {
    transaction: jest.fn(
      (run: (m: EntityManager) => Promise<unknown>) => run(manager),
    ),
  };

  let service: WalletsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    dataSource.transaction.mockImplementation((run: (m: EntityManager) => Promise<unknown>) =>
      run(manager),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: WalletRepository, useValue: wallets },
        { provide: LedgerEntryRepository, useValue: ledger },
        { provide: UsersService, useValue: users },
        { provide: getDataSourceToken(), useValue: dataSource as unknown as DataSource },
      ],
    }).compile();

    service = moduleRef.get(WalletsService);
  });

  describe('debit', () => {
    it('moves the balance through the conditional update and appends one ledger row', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(null);
      wallets.move.mockResolvedValue({ applied: true, balance_after: 7_500 });
      ledger.append.mockImplementation((entry: Partial<LedgerEntry>) => ({
        ...entry,
        reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
      }));

      const result = await service.debit(WALLET_REFERENCE, requestFixture());

      // Negative delta: the direction is expressed to the database, never by
      // reading the balance and writing a computed value back.
      expect(wallets.move).toHaveBeenCalledWith(
        walletFixture().id,
        -2_500,
        Currency.XOF,
        manager,
      );
      expect(ledger.append).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        status: TransactionStatus.APPROVED,
        balance_before: 10_000,
        balance_after: 7_500,
        declined_reason: null,
      });
    });

    it('declines without writing when the conditional update refuses the move', async () => {
      const wallet = walletFixture({ balance: 1_000 });
      wallets.findByReference.mockResolvedValue(wallet);
      ledger.findByIdempotencyKey.mockResolvedValue(null);
      wallets.move.mockResolvedValue({ applied: false, balance_after: 0 });

      await expect(service.debit(WALLET_REFERENCE, requestFixture())).rejects.toBeInstanceOf(
        InsufficientBalanceException,
      );
      expect(ledger.append).not.toHaveBeenCalled();
    });

    it('carries the declined operation in the failure payload', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture({ balance: 1_000 }));
      ledger.findByIdempotencyKey.mockResolvedValue(null);
      wallets.move.mockResolvedValue({ applied: false, balance_after: 0 });

      await expect(service.debit(WALLET_REFERENCE, requestFixture())).rejects.toMatchObject({
        payload: {
          status: TransactionStatus.DECLINED,
          declined_reason: DeclinedReason.INSUFFICIENT_BALANCE,
          reference: null,
          balance_before: 1_000,
          balance_after: 1_000,
        },
      });
    });

    it('refuses a frozen wallet before touching the balance', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture({ status: WalletStatus.FROZEN }));
      ledger.findByIdempotencyKey.mockResolvedValue(null);

      await expect(service.debit(WALLET_REFERENCE, requestFixture())).rejects.toBeInstanceOf(
        WalletFrozenException,
      );
      expect(wallets.move).not.toHaveBeenCalled();
    });

    it('refuses a movement in another currency, whatever the balance', async () => {
      // The wallet is held in XOF; nothing converts, so the request is declined
      // before the balance is even consulted.
      wallets.findByReference.mockResolvedValue(walletFixture({ currency: 'EUR' as Currency }));
      ledger.findByIdempotencyKey.mockResolvedValue(null);

      await expect(service.debit(WALLET_REFERENCE, requestFixture())).rejects.toBeInstanceOf(
        CurrencyMismatchException,
      );
      expect(wallets.move).not.toHaveBeenCalled();
      expect(ledger.append).not.toHaveBeenCalled();
    });

    it('reports an unknown wallet', async () => {
      wallets.findByReference.mockResolvedValue(null);

      await expect(service.debit(WALLET_REFERENCE, requestFixture())).rejects.toBeInstanceOf(
        WalletNotFoundException,
      );
    });
  });

  describe('idempotency', () => {
    const recorded = {
      transaction_id: 'tx-00000001',
      reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
      type: TransactionType.DEBIT,
      amount: 2_500,
      currency: Currency.XOF,
      balance_before: 10_000,
      balance_after: 7_500,
    } as LedgerEntry;

    it('returns the original movement on a replay, without moving money again', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(recorded);

      const result = await service.debit(WALLET_REFERENCE, requestFixture());

      expect(result).toEqual({
        transaction_id: 'tx-00000001',
        reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
        amount: 2_500,
        currency: Currency.XOF,
        balance_before: 10_000,
        balance_after: 7_500,
        status: TransactionStatus.APPROVED,
        declined_reason: null,
      });
      expect(wallets.move).not.toHaveBeenCalled();
      expect(ledger.append).not.toHaveBeenCalled();
    });

    it('refuses a key replayed with a different amount', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(recorded);

      await expect(
        service.debit(WALLET_REFERENCE, requestFixture({ amount: 5_000 })),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
      expect(wallets.move).not.toHaveBeenCalled();
    });

    it('refuses a key replayed in the opposite direction', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(recorded);

      await expect(
        service.credit(WALLET_REFERENCE, requestFixture()),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
      expect(wallets.move).not.toHaveBeenCalled();
    });

    it('returns the winning movement when a concurrent replay loses the unique constraint', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(recorded);
      wallets.move.mockResolvedValue({ applied: true, balance_after: 7_500 });
      ledger.append.mockRejectedValue(
        Object.assign(new Error('duplicate key'), {
          code: PG_UNIQUE_VIOLATION,
          constraint: 'uq_ledger_entries_wallet_transaction',
        }),
      );

      const result = await service.debit(WALLET_REFERENCE, requestFixture());

      expect(result.reference).toBe(recorded.reference);
      expect(result.status).toBe(TransactionStatus.APPROVED);
    });
  });

  describe('finding a movement by its key', () => {
    const recorded = {
      transaction_id: 'pay_01hq3m8x0000zt7k9d2v4bqf1c',
      reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
      type: TransactionType.DEBIT,
      amount: 2_500,
      currency: Currency.XOF,
      balance_before: 10_000,
      balance_after: 7_500,
    } as LedgerEntry;

    it('returns the movement the key produced', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(recorded);

      const found = await service.findMovement(WALLET_REFERENCE, recorded.transaction_id);

      expect(found).toBe(recorded);
      expect(ledger.findByIdempotencyKey).toHaveBeenCalledWith(
        walletFixture().id,
        recorded.transaction_id,
      );
    });

    it('returns nothing when the key never moved money here', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(null);

      await expect(service.findMovement(WALLET_REFERENCE, 'never-used')).resolves.toBeNull();
    });

    it('moves nothing, whatever the answer', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(null);

      await service.findMovement(WALLET_REFERENCE, 'never-used');

      // The caller asks this precisely because it does not want a side effect.
      expect(wallets.move).not.toHaveBeenCalled();
      expect(ledger.append).not.toHaveBeenCalled();
    });

    it('reports an unknown wallet', async () => {
      wallets.findByReference.mockResolvedValue(null);

      await expect(service.findMovement(WALLET_REFERENCE, 'anything')).rejects.toBeInstanceOf(
        WalletNotFoundException,
      );
    });
  });

  describe('credit', () => {
    it('applies a positive delta', async () => {
      wallets.findByReference.mockResolvedValue(walletFixture());
      ledger.findByIdempotencyKey.mockResolvedValue(null);
      wallets.move.mockResolvedValue({ applied: true, balance_after: 12_500 });
      ledger.append.mockImplementation((entry: Partial<LedgerEntry>) => entry);

      const result = await service.credit(WALLET_REFERENCE, requestFixture());

      expect(wallets.move).toHaveBeenCalledWith(walletFixture().id, 2_500, Currency.XOF, manager);
      expect(result.balance_before).toBe(10_000);
      expect(result.balance_after).toBe(12_500);
    });
  });
});
