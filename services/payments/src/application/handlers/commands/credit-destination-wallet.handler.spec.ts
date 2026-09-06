import { EventBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { AccountsUnavailableError } from '../../../domain/errors/accounts-unavailable.error';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { PaymentApprovedEvent } from '../../../domain/events/payment-approved.event';
import { Payment } from '../../../domain/model/payment';
import { PaymentStatus } from '../../../domain/model/payment-status';
import { ACCOUNTS_PORT } from '../../../domain/ports/accounts.port';
import { LedgerMovement } from '../../../domain/ports/transactions.port';
import { PAYMENT_REPOSITORY } from '../../../domain/ports/payment.repository';
import { TRANSACTIONS_PORT } from '../../../domain/ports/transactions.port';
import { TRANSACTION_RUNNER } from '../../../domain/ports/transaction-runner.port';
import {
  CREDIT,
  DEBIT,
  DESTINATION,
  InMemoryPaymentRepository,
  SOURCE,
  aDebitedPayment,
  aPayment,
  movement,
} from '../../../testing/doubles';
import { CreditDestinationWalletCommand } from '../../commands/credit-destination-wallet.command';
import { CreditDestinationWalletHandler } from './credit-destination-wallet.handler';

describe('CreditDestinationWalletHandler', () => {
  const accounts = { debit: jest.fn(), credit: jest.fn() };
  const ledger = { record: jest.fn() };
  const events = { publishAll: jest.fn() };
  /** Records the order of the writes, to prove they share one unit of work. */
  let journal: string[];

  async function handlerFor(stored: Payment | null) {
    const payments = new InMemoryPaymentRepository(stored);
    const transaction = {
      run: async <T>(work: () => Promise<T>): Promise<T> => {
        journal.push('transaction:begin');
        const result = await work();
        journal.push('transaction:commit');
        return result;
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CreditDestinationWalletHandler,
        { provide: PAYMENT_REPOSITORY, useValue: payments },
        { provide: ACCOUNTS_PORT, useValue: accounts },
        { provide: TRANSACTIONS_PORT, useValue: ledger },
        { provide: TRANSACTION_RUNNER, useValue: transaction },
        { provide: EventBus, useValue: events },
      ],
    }).compile();
    return { handler: moduleRef.get(CreditDestinationWalletHandler), payments };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    journal = [];
    ledger.record.mockImplementation(() => {
      journal.push('ledger');
      return Promise.resolve();
    });
  });

  const command = (payment: Payment) =>
    new CreditDestinationWalletCommand(payment.reference.value);

  it('credits the destination and approves the payment', async () => {
    const payment = aDebitedPayment();
    const { handler } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(CREDIT));

    const result = await handler.execute(command(payment));

    expect(result).toBe(CREDIT.value);
    expect(payment.status).toBe(PaymentStatus.Approved);
    expect(payment.completedAt).toBeInstanceOf(Date);
    expect(accounts.credit).toHaveBeenCalledWith(
      DESTINATION,
      payment.money,
      `${payment.reference.value}:credit`,
      { description: payment.description, paymentReference: payment.reference },
    );
  });

  it('hands the ledger both movements, inside the approving transaction', async () => {
    const payment = aDebitedPayment();
    const { handler } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(CREDIT));

    await handler.execute(command(payment));

    const [, movements] = ledger.record.mock.calls[0] as [Payment, LedgerMovement[]];
    expect(movements.map((entry) => entry.type)).toEqual(['DEBIT', 'CREDIT']);
    expect(movements[0]).toMatchObject({
      wallet: SOURCE,
      movementReference: DEBIT,
      transactionId: payment.reference.value,
    });
    expect(movements[1]).toMatchObject({
      wallet: DESTINATION,
      movementReference: CREDIT,
      transactionId: `${payment.reference.value}:credit`,
    });
    // One commit covers the status change and the outbox rows: the ledger can
    // never hear about a payment the database rolled back.
    expect(journal).toEqual(['transaction:begin', 'ledger', 'transaction:commit']);
  });

  it('publishes the approval only after the commit', async () => {
    const payment = aDebitedPayment();
    const { handler } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(CREDIT));
    events.publishAll.mockImplementation(() => journal.push('published'));

    await handler.execute(command(payment));

    expect(journal[journal.length - 1]).toBe('published');
    expect(events.publishAll).toHaveBeenCalledWith([expect.any(PaymentApprovedEvent)]);
  });

  it('leaves the payment untouched when the credit fails, for the saga to unwind', async () => {
    const payment = aDebitedPayment();
    const { handler, payments } = await handlerFor(payment);
    accounts.credit.mockRejectedValue(new AccountsUnavailableError('credit'));

    await expect(handler.execute(command(payment))).rejects.toBeInstanceOf(
      AccountsUnavailableError,
    );

    // Not Declined: the source is already short, so only a refund can settle it.
    expect(payment.status).toBe(PaymentStatus.Processing);
    expect(payments.saved).toEqual([]);
    expect(ledger.record).not.toHaveBeenCalled();
    expect(events.publishAll).not.toHaveBeenCalled();
  });

  it('refuses to approve a payment that was never debited', async () => {
    const payment = aPayment();
    payment.markProcessing();
    const { handler } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(CREDIT));

    await expect(handler.execute(command(payment))).rejects.toThrow();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('reports a payment that does not exist', async () => {
    const { handler } = await handlerFor(null);

    await expect(
      handler.execute(new CreditDestinationWalletCommand('pay_01hq3m8x0000zt7k9d2v4bqf1c')),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(accounts.credit).not.toHaveBeenCalled();
  });
});
