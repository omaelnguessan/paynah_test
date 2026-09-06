import { Test } from '@nestjs/testing';
import {
  Currency,
  PG_UNIQUE_VIOLATION,
  TransactionNotFoundException,
  TransactionStatus,
  TransactionType,
} from '@paynad/shared';
import { ListTransactionsQuery } from './dto/list-transactions.query';
import { RecordTransactionRequest } from './dto/record-transaction.request';
import { Transaction } from './entities/transaction.entity';
import { TransactionRepository } from './repositories/transaction.repository';
import { TransactionsService, UnscopedHistoryException } from './transactions.service';

const USER = 'usr_01hq3m8x0000zt7k9d2v4bqf1c';
const WALLET = 'wlt_01hq3m8x0000zt7k9d2v4bqf1c';

function requestFixture(overrides: Partial<RecordTransactionRequest> = {}): RecordTransactionRequest {
  return {
    transaction_id: 'tx-00000001',
    payment_reference: 'pay_01hq3m8x0000zt7k9d2v4bqf1c',
    type: TransactionType.DEBIT,
    wallet_reference: WALLET,
    user_reference: USER,
    amount: 5_000,
    currency: Currency.XOF,
    description: 'Paiement facture avril',
    status: TransactionStatus.APPROVED,
    occurred_at: '2026-09-06T10:15:00.000Z',
    ...overrides,
  };
}

function rowFixture(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'b2c3d4e5-0000-4000-8000-000000000001',
    reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
    ...requestFixture(),
    occurred_at: new Date('2026-09-06T10:15:00.000Z'),
    recorded_at: new Date('2026-09-06T10:15:02.412Z'),
    ...overrides,
  } as Transaction;
}

describe('TransactionsService', () => {
  const transactions = {
    append: jest.fn(),
    findByTransactionId: jest.fn(),
    findByReference: jest.fn(),
    findPage: jest.fn(),
  };
  let service: TransactionsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: TransactionRepository, useValue: transactions },
      ],
    }).compile();
    service = moduleRef.get(TransactionsService);
  });

  describe('record', () => {
    it('appends a movement and reports it as created', async () => {
      transactions.findByTransactionId.mockResolvedValue(null);
      transactions.append.mockImplementation((row: Partial<Transaction>) => rowFixture(row));

      const outcome = await service.record(requestFixture());

      expect(outcome.created).toBe(true);
      expect(transactions.append).toHaveBeenCalledTimes(1);
      // The business time is stored as a date, separate from the insertion time.
      expect(transactions.append.mock.calls[0][0].occurred_at).toEqual(
        new Date('2026-09-06T10:15:00.000Z'),
      );
      expect(transactions.append.mock.calls[0][0].reference).toMatch(/^trx_/);
    });

    it('returns the stored row on a replay, without appending again', async () => {
      const stored = rowFixture();
      transactions.findByTransactionId.mockResolvedValue(stored);

      const outcome = await service.record(requestFixture());

      expect(outcome).toEqual({ transaction: stored, created: false });
      expect(transactions.append).not.toHaveBeenCalled();
    });

    it('falls back to the stored row when a concurrent delivery wins the constraint', async () => {
      const stored = rowFixture();
      transactions.findByTransactionId.mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
      transactions.append.mockRejectedValue(
        Object.assign(new Error('duplicate key'), {
          code: PG_UNIQUE_VIOLATION,
          constraint: 'uq_transactions_transaction_id',
        }),
      );

      const outcome = await service.record(requestFixture());

      expect(outcome).toEqual({ transaction: stored, created: false });
    });

    it('lets an unrelated database failure surface', async () => {
      transactions.findByTransactionId.mockResolvedValue(null);
      transactions.append.mockRejectedValue(new Error('connection terminated'));

      await expect(service.record(requestFixture())).rejects.toThrow('connection terminated');
    });
  });

  describe('history', () => {
    it('refuses a query scoped to neither a user nor a wallet', async () => {
      await expect(service.history({} as ListTransactionsQuery)).rejects.toBeInstanceOf(
        UnscopedHistoryException,
      );
      expect(transactions.findPage).not.toHaveBeenCalled();
    });

    it('refuses to fall back to a full scan when only a type is given', async () => {
      await expect(
        service.history({ type: TransactionType.REFUND } as ListTransactionsQuery),
      ).rejects.toBeInstanceOf(UnscopedHistoryException);
    });

    it('answers a 422, not a 400 — the query is well formed, just unserved', async () => {
      await expect(service.history({} as ListTransactionsQuery)).rejects.toMatchObject({
        code: '4000',
      });
      const error = await service.history({} as ListTransactionsQuery).catch((e) => e);
      expect(error.getStatus()).toBe(422);
    });

    it('applies the default page size and reports has_next', async () => {
      transactions.findPage.mockResolvedValue([[rowFixture()], 45]);

      const page = await service.history({ user_reference: USER } as ListTransactionsQuery);

      expect(transactions.findPage).toHaveBeenCalledWith(
        { user_reference: USER, wallet_reference: undefined, type: undefined },
        { page: 1, perPage: 20, skip: 0 },
      );
      expect(page).toMatchObject({ page: 1, per_page: 20, total: 45, has_next: true });
      expect(page.items).toHaveLength(1);
    });

    it('reports the last page as having no next', async () => {
      transactions.findPage.mockResolvedValue([[rowFixture()], 45]);

      const page = await service.history({
        wallet_reference: WALLET,
        page: 3,
        per_page: 20,
      } as ListTransactionsQuery);

      expect(transactions.findPage).toHaveBeenCalledWith(expect.anything(), {
        page: 3,
        perPage: 20,
        skip: 40,
      });
      expect(page.has_next).toBe(false);
    });
  });

  describe('findByReference', () => {
    it('reports an unknown reference', async () => {
      transactions.findByReference.mockResolvedValue(null);

      await expect(service.findByReference('trx_01hq3m8x0000zt7k9d2v4bqf1c')).rejects.toBeInstanceOf(
        TransactionNotFoundException,
      );
    });
  });
});
