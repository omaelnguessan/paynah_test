import { EventBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import {
  IdempotencyConflictError,
  RequestInProgressError,
} from '../../../domain/errors/payment.errors';
import { SameWalletError } from '../../../domain/errors/wallet.errors';
import { Currency } from '../../../domain/model/money';
import { PaymentStatus } from '../../../domain/model/payment-status';
import { IDEMPOTENCY_REPOSITORY } from '../../../domain/ports/idempotency.repository';
import { PAYMENT_REPOSITORY } from '../../../domain/ports/payment.repository';
import { TRANSACTION_RUNNER } from '../../../domain/ports/transaction-runner.port';
import {
  DESTINATION,
  InMemoryIdempotencyRepository,
  InMemoryPaymentRepository,
  SOURCE,
  inlineTransaction,
} from '../../../testing/doubles';
import { InitiatePaymentCommand } from '../../commands/initiate-payment.command';
import { PaymentSaga } from '../../sagas/payment.saga';
import { IdempotencyService } from '../../services/idempotency.service';
import { InitiatePaymentHandler } from './initiate-payment.handler';

describe('InitiatePaymentHandler', () => {
  const saga = { run: jest.fn() };
  const events = { publishAll: jest.fn() };
  let payments: InMemoryPaymentRepository;
  let keys: InMemoryIdempotencyRepository;
  let handler: InitiatePaymentHandler;

  beforeEach(async () => {
    jest.resetAllMocks();
    payments = new InMemoryPaymentRepository();
    keys = new InMemoryIdempotencyRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        InitiatePaymentHandler,
        IdempotencyService,
        { provide: IDEMPOTENCY_REPOSITORY, useValue: keys },
        { provide: PAYMENT_REPOSITORY, useValue: payments },
        { provide: TRANSACTION_RUNNER, useValue: inlineTransaction },
        { provide: PaymentSaga, useValue: saga },
        { provide: EventBus, useValue: events },
      ],
    }).compile();
    handler = moduleRef.get(InitiatePaymentHandler);
  });

  const command = (overrides: Partial<InitiatePaymentCommand> = {}) =>
    new InitiatePaymentCommand(
      overrides.transactionId ?? 'tx-00000001',
      overrides.sourceWallet ?? SOURCE.value,
      overrides.destinationWallet ?? DESTINATION.value,
      overrides.amount ?? 5_000,
      overrides.currency ?? Currency.XOF,
      overrides.description ?? 'Paiement facture avril',
      overrides.lang ?? 'fr',
      overrides.metadata ?? null,
    );

  it('persists the payment as Pending before the saga makes a single call', async () => {
    saga.run.mockImplementation(() => {
      expect(payments.statuses).toEqual([PaymentStatus.Pending]);
      return Promise.resolve();
    });

    const result = await handler.execute(command());

    expect(result.reference).toMatch(/^pay_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(saga.run).toHaveBeenCalledTimes(1);
    expect(saga.run.mock.calls[0][0].value).toBe(result.reference);
  });

  it('replays a completed key without running the saga again', async () => {
    saga.run.mockResolvedValue(undefined);
    const first = await handler.execute(command());

    const replay = await handler.execute(command());

    expect(replay).toEqual(first);
    expect(saga.run).toHaveBeenCalledTimes(1);
    expect(payments.saved).toHaveLength(1);
  });

  it('refuses the same key carrying a different payload', async () => {
    saga.run.mockResolvedValue(undefined);
    await handler.execute(command());

    await expect(handler.execute(command({ amount: 9_000 }))).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  it('holds the key while the first attempt is still running', async () => {
    let release: () => void = () => undefined;
    saga.run.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));

    const inFlight = handler.execute(command());
    await expect(handler.execute(command())).rejects.toBeInstanceOf(RequestInProgressError);

    release();
    await inFlight;
  });

  it('frees the key when the attempt fails, so the caller may retry it', async () => {
    saga.run.mockRejectedValueOnce(new Error('the process died mid-saga'));

    await expect(handler.execute(command())).rejects.toThrow('the process died mid-saga');
    expect(keys.size).toBe(0);

    saga.run.mockResolvedValueOnce(undefined);
    await expect(handler.execute(command())).resolves.toMatchObject({
      reference: expect.stringMatching(/^pay_/),
    });
  });

  it('never claims a key for a payment the domain refuses to build', async () => {
    await expect(
      handler.execute(command({ destinationWallet: SOURCE.value })),
    ).rejects.toBeInstanceOf(SameWalletError);

    expect(keys.size).toBe(0);
    expect(payments.saved).toEqual([]);
    expect(saga.run).not.toHaveBeenCalled();
  });

});
