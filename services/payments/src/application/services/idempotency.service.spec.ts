import { TRANSACTION_RUNNER } from '../../domain/ports/transaction-runner.port';
import { inlineTransaction } from '../../testing/doubles';
import { Test } from '@nestjs/testing';
import {
  IdempotencyConflictError,
  RequestInProgressError,
} from '../../domain/errors/payment.errors';
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyStatus,
} from '../../domain/ports/idempotency.repository';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  const keys = {
    claim: jest.fn(),
    find: jest.fn(),
    complete: jest.fn(),
    release: jest.fn(),
  };
  let service: IdempotencyService;

  const payload = { amount: 5_000, currency: 'XOF' };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: IDEMPOTENCY_REPOSITORY, useValue: keys },
        { provide: TRANSACTION_RUNNER, useValue: inlineTransaction },
      ],
    }).compile();
    service = moduleRef.get(IdempotencyService);
  });

  describe('the first request', () => {
    it('claims the key, runs the work, then stores the response', async () => {
      const order: string[] = [];
      keys.claim.mockImplementation(() => {
        order.push('claim');
        return Promise.resolve(true);
      });
      const work = jest.fn().mockImplementation(() => {
        order.push('work');
        return Promise.resolve({ result: { reference: 'pay_x' }, paymentReference: 'pay_x' });
      });

      const outcome = await service.execute('tx-00000001', payload, work);

      // Claim before work: the insert is what reserves the key, not a lookup.
      expect(order).toEqual(['claim', 'work']);
      expect(keys.find).not.toHaveBeenCalled();
      expect(keys.complete).toHaveBeenCalledWith('tx-00000001', 'pay_x', { reference: 'pay_x' });
      expect(outcome).toEqual({ result: { reference: 'pay_x' }, replayed: false });
    });

    it('propagates a failure to roll back the transaction without deleting a key', async () => {
      keys.claim.mockResolvedValue(true);

      await expect(
        service.execute('tx-00000001', payload, () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');

      expect(keys.release).not.toHaveBeenCalled();
      expect(keys.complete).not.toHaveBeenCalled();
    });
  });

  describe('a replay', () => {
    it('returns the stored response without running the work again', async () => {
      keys.claim.mockResolvedValue(false);
      keys.find.mockResolvedValue({
        key: 'tx-00000001',
        requestHash: IdempotencyService.hash(payload),
        status: IdempotencyStatus.COMPLETED,
        paymentReference: 'pay_x',
        responseBody: { reference: 'pay_x' },
      });
      const work = jest.fn();

      const outcome = await service.execute('tx-00000001', payload, work);

      expect(work).not.toHaveBeenCalled();
      expect(outcome).toEqual({ result: { reference: 'pay_x' }, replayed: true });
    });

    it('refuses the same key with a different payload', async () => {
      keys.claim.mockResolvedValue(false);
      keys.find.mockResolvedValue({
        key: 'tx-00000001',
        requestHash: IdempotencyService.hash({ amount: 9_000, currency: 'XOF' }),
        status: IdempotencyStatus.COMPLETED,
        paymentReference: 'pay_x',
        responseBody: { reference: 'pay_x' },
      });

      await expect(service.execute('tx-00000001', payload, jest.fn())).rejects.toBeInstanceOf(
        IdempotencyConflictError,
      );
    });

    it('refuses a key whose first attempt is still running', async () => {
      keys.claim.mockResolvedValue(false);
      keys.find.mockResolvedValue({
        key: 'tx-00000001',
        requestHash: IdempotencyService.hash(payload),
        status: IdempotencyStatus.IN_PROGRESS,
        paymentReference: null,
        responseBody: null,
      });

      await expect(service.execute('tx-00000001', payload, jest.fn())).rejects.toBeInstanceOf(
        RequestInProgressError,
      );
    });

    it('handles a claim that was released between the insert and the read', async () => {
      keys.claim.mockResolvedValue(false);
      keys.find.mockResolvedValue(null);

      await expect(service.execute('tx-00000001', payload, jest.fn())).rejects.toBeInstanceOf(
        RequestInProgressError,
      );
    });
  });

  describe('the request hash', () => {
    it('ignores key order, so a reordered body is still the same request', () => {
      expect(IdempotencyService.hash({ a: 1, b: 2 })).toBe(IdempotencyService.hash({ b: 2, a: 1 }));
    });

    it('changes when a value changes', () => {
      expect(IdempotencyService.hash({ amount: 5_000 })).not.toBe(
        IdempotencyService.hash({ amount: 5_005 }),
      );
    });

    it('distinguishes a missing field from a null one', () => {
      expect(IdempotencyService.hash({ a: 1 })).not.toBe(
        IdempotencyService.hash({ a: 1, b: null }),
      );
    });

    it('is stable across nesting and arrays', () => {
      expect(IdempotencyService.hash({ m: { x: 1, y: [1, 2] } })).toBe(
        IdempotencyService.hash({ m: { y: [1, 2], x: 1 } }),
      );
    });
  });
});
