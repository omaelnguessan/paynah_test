import { PAYMENT_EXECUTION } from '../../../domain/ports/payment-execution.port';
import { EventBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { AccountsUnavailableError } from '../../../domain/errors/accounts-unavailable.error';
import { InsufficientBalanceError } from '../../../domain/errors/insufficient-balance.error';
import { WalletFrozenError } from '../../../domain/errors/wallet.errors';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { PaymentDeclinedEvent } from '../../../domain/events/payment-declined.event';
import { Payment } from '../../../domain/model/payment';
import { FailureReason, PaymentStatus } from '../../../domain/model/payment-status';
import { ACCOUNTS_PORT } from '../../../domain/ports/accounts.port';
import { PAYMENT_REPOSITORY } from '../../../domain/ports/payment.repository';
import { TRANSACTION_RUNNER } from '../../../domain/ports/transaction-runner.port';
import {
  DEBIT,
  InMemoryPaymentRepository,
  SOURCE,
  aPayment,
  inlineTransaction,
  movement,
} from '../../../testing/doubles';
import { DebitSourceWalletCommand } from '../../commands/debit-source-wallet.command';
import { DebitSourceWalletHandler } from './debit-source-wallet.handler';

describe('DebitSourceWalletHandler', () => {
  const accounts = { debit: jest.fn(), credit: jest.fn() };
  const events = { publishAll: jest.fn() };

  async function handlerFor(stored: Payment | null) {
    const payments = new InMemoryPaymentRepository(stored);
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: PAYMENT_EXECUTION,
          useValue: { run: (_key: string, work: () => Promise<unknown>) => work() },
        },
        DebitSourceWalletHandler,
        { provide: PAYMENT_REPOSITORY, useValue: payments },
        { provide: ACCOUNTS_PORT, useValue: accounts },
        { provide: TRANSACTION_RUNNER, useValue: inlineTransaction },
        { provide: EventBus, useValue: events },
      ],
    }).compile();
    return { handler: moduleRef.get(DebitSourceWalletHandler), payments };
  }

  beforeEach(() => jest.resetAllMocks());

  const command = (payment: Payment) => new DebitSourceWalletCommand(payment.reference.value);

  it('refuses a repeated debit before calling accounts', async () => {
    const payment = aPayment();
    payment.markProcessing();
    const { handler } = await handlerFor(payment);
    await expect(handler.execute(command(payment))).rejects.toThrow();
    expect(accounts.debit).not.toHaveBeenCalled();
  });

  it('moves to Processing before calling accounts, so a crash leaves a trace', async () => {
    const payment = aPayment();
    const { handler, payments } = await handlerFor(payment);
    accounts.debit.mockImplementation(() => {
      // Whatever happens next, the payment is already durable as Processing.
      expect(payments.statuses).toEqual([PaymentStatus.Processing]);
      return Promise.resolve(movement(DEBIT));
    });

    const result = await handler.execute(command(payment));

    expect(result).toBe(DEBIT.value);
    expect(payment.debitTransactionReference?.value).toBe(DEBIT.value);
  });

  it('debits with the payment reference as the idempotency key', async () => {
    const payment = aPayment();
    const { handler } = await handlerFor(payment);
    accounts.debit.mockResolvedValue(movement(DEBIT));

    await handler.execute(command(payment));

    expect(accounts.debit).toHaveBeenCalledWith(SOURCE, payment.money, payment.reference.value, {
      description: payment.description,
      paymentReference: payment.reference,
    });
  });

  it('declines and rethrows when accounts refuses the movement', async () => {
    const payment = aPayment();
    const { handler, payments } = await handlerFor(payment);
    accounts.debit.mockRejectedValue(new InsufficientBalanceError(SOURCE.value));

    await expect(handler.execute(command(payment))).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );

    expect(payment.status).toBe(PaymentStatus.Declined);
    expect(payment.failureReason).toBe(FailureReason.INSUFFICIENT_BALANCE);
    expect(payments.statuses).toEqual([PaymentStatus.Processing, PaymentStatus.Declined]);
    // The refusal is persisted first, published second.
    expect(events.publishAll).toHaveBeenCalledWith([expect.any(PaymentDeclinedEvent)]);
  });

  it('never declines a payment whose debit outcome is unknown', async () => {
    const payment = aPayment();
    const { handler, payments } = await handlerFor(payment);
    accounts.debit.mockRejectedValue(new AccountsUnavailableError('debit'));

    await expect(handler.execute(command(payment))).rejects.toBeInstanceOf(
      AccountsUnavailableError,
    );

    // `accounts` may have applied the debit and lost the answer on the way
    // back. Declining here would close the payment over money already gone, so
    // it stays Processing — which is what the reconciler looks for.
    expect(payment.status).toBe(PaymentStatus.Processing);
    expect(payment.failureReason).toBeNull();
    expect(payments.statuses).toEqual([PaymentStatus.Processing]);
    expect(events.publishAll).not.toHaveBeenCalled();
  });

  it('still declines when accounts refused for a reason it can name', async () => {
    const payment = aPayment();
    const { handler } = await handlerFor(payment);
    accounts.debit.mockRejectedValue(new WalletFrozenError(SOURCE.value));

    await expect(handler.execute(command(payment))).rejects.toBeInstanceOf(WalletFrozenError);

    // A named refusal means the service answered and nothing moved: terminal.
    expect(payment.status).toBe(PaymentStatus.Declined);
    expect(payment.failureReason).toBe(FailureReason.WALLET_FROZEN);
  });

  it('lets a non-domain failure through without touching the payment', async () => {
    const payment = aPayment();
    const { handler, payments } = await handlerFor(payment);
    accounts.debit.mockRejectedValue(new Error('the socket is on fire'));

    await expect(handler.execute(command(payment))).rejects.toThrow('the socket is on fire');

    // Still Processing: an unexplained error is not a business outcome, so the
    // reconciler — not this handler — decides what the payment becomes.
    expect(payment.status).toBe(PaymentStatus.Processing);
    expect(payments.statuses).toEqual([PaymentStatus.Processing]);
    expect(events.publishAll).not.toHaveBeenCalled();
  });

  it('reports a payment that does not exist', async () => {
    const { handler } = await handlerFor(null);

    await expect(
      handler.execute(new DebitSourceWalletCommand('pay_01hq3m8x0000zt7k9d2v4bqf1c')),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(accounts.debit).not.toHaveBeenCalled();
  });
});
