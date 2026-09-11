import { PAYMENT_EXECUTION } from '../../../domain/ports/payment-execution.port';
import { PaymentEvents } from '../../services/payment-events.service';
import { Test } from '@nestjs/testing';
import { AccountsUnavailableError } from '../../../domain/errors/accounts-unavailable.error';
import { InvalidTransitionError } from '../../../domain/errors/invalid-transition.error';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { PaymentCompensatedEvent } from '../../../domain/events/payment-compensated.event';
import { PaymentDeclinedEvent } from '../../../domain/events/payment-declined.event';
import { Payment } from '../../../domain/model/payment';
import { FailureReason, PaymentStatus } from '../../../domain/model/payment-status';
import { ACCOUNTS_PORT } from '../../../domain/ports/accounts.port';
import { PAYMENT_REPOSITORY } from '../../../domain/ports/payment.repository';
import { LedgerMovement, TRANSACTIONS_PORT } from '../../../domain/ports/transactions.port';
import { TRANSACTION_RUNNER } from '../../../domain/ports/transaction-runner.port';
import {
  CREDIT,
  DEBIT,
  DESTINATION,
  InMemoryPaymentRepository,
  REFUND,
  SOURCE,
  aDebitedPayment,
  aPayment,
  inlineTransaction,
  movement,
} from '../../../testing/doubles';
import { CompensatePaymentCommand } from '../../commands/compensate-payment.command';
import { CompensatePaymentHandler } from './compensate-payment.handler';

describe('CompensatePaymentHandler', () => {
  const accounts = { debit: jest.fn(), credit: jest.fn(), findMovement: jest.fn() };
  const ledger = { record: jest.fn() };
  const events = { enqueue: jest.fn() };

  async function handlerFor(stored: Payment | null) {
    const payments = new InMemoryPaymentRepository(stored);
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: PAYMENT_EXECUTION,
          useValue: { run: (_key: string, work: () => Promise<unknown>) => work() },
        },
        CompensatePaymentHandler,
        { provide: PAYMENT_REPOSITORY, useValue: payments },
        { provide: ACCOUNTS_PORT, useValue: accounts },
        { provide: TRANSACTIONS_PORT, useValue: ledger },
        { provide: TRANSACTION_RUNNER, useValue: inlineTransaction },
        { provide: PaymentEvents, useValue: events },
      ],
    }).compile();
    return { handler: moduleRef.get(CompensatePaymentHandler), payments };
  }

  beforeEach(() => jest.resetAllMocks());

  const command = (payment: Payment) => new CompensatePaymentCommand(payment.reference.value);

  it('credits the source back and marks the payment Compensated', async () => {
    const payment = aDebitedPayment();
    payment.markCompensationPending(FailureReason.CREDIT_FAILED);
    const { handler } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(REFUND));

    const result = await handler.execute(command(payment));

    expect(result).toBe(REFUND.value);
    expect(payment.status).toBe(PaymentStatus.Compensated);
    expect(payment.refundTransactionReference?.value).toBe(REFUND.value);
    expect(payment.failureReason).toBe(FailureReason.CREDIT_FAILED);
    // The refund goes back to where the money came from, under its own key.
    expect(accounts.credit).toHaveBeenCalledWith(
      SOURCE,
      payment.money,
      `${payment.reference.value}:refund`,
      { description: 'Refund of a failed payment', paymentReference: payment.reference },
    );
  });

  it('journalises the refund as its own ledger movement', async () => {
    const payment = aDebitedPayment();
    payment.markCompensationPending(FailureReason.CREDIT_FAILED);
    const { handler } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(REFUND));

    await handler.execute(command(payment));

    const [, movements] = ledger.record.mock.calls[0] as [Payment, LedgerMovement[]];
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'REFUND',
      wallet: SOURCE,
      movementReference: REFUND,
      transactionId: `${payment.reference.value}:refund`,
    });
    expect(events.enqueue).toHaveBeenCalledWith([expect.any(PaymentCompensatedEvent)]);
  });

  it('is safe to run twice: a compensated payment is returned as it stands', async () => {
    const payment = aDebitedPayment();
    payment.compensate(REFUND);
    payment.pullEvents();
    const { handler, payments } = await handlerFor(payment);

    const result = await handler.execute(command(payment));

    expect(result).toBe(REFUND.value);
    expect(accounts.credit).not.toHaveBeenCalled();
    expect(payments.saved).toEqual([]);
  });

  it('parks the payment as CompensationPending when the refund does not go through', async () => {
    const payment = aDebitedPayment();
    payment.markCompensationPending(FailureReason.CREDIT_FAILED);
    const { handler, payments } = await handlerFor(payment);
    accounts.credit.mockRejectedValue(new AccountsUnavailableError('credit'));

    // Swallowed on purpose: the saga has nothing left to try, and the
    // reconciler picks the payment up from this state.
    await expect(handler.execute(command(payment))).resolves.toBeNull();

    expect(payment.status).toBe(PaymentStatus.CompensationPending);
    expect(payments.statuses).toEqual([]);
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('does not park a payment twice when the reconciler retries and fails again', async () => {
    const payment = aDebitedPayment();
    payment.markCompensationPending(FailureReason.CREDIT_FAILED);
    const { handler, payments } = await handlerFor(payment);
    accounts.credit.mockRejectedValue(new AccountsUnavailableError('credit'));

    await expect(handler.execute(command(payment))).resolves.toBeNull();

    expect(payment.status).toBe(PaymentStatus.CompensationPending);
    expect(payments.saved).toEqual([]);
  });

  it('settles a payment the reconciler picked up from CompensationPending', async () => {
    const payment = aDebitedPayment();
    payment.markCompensationPending(FailureReason.CREDIT_FAILED);
    const { handler } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(REFUND));

    await expect(handler.execute(command(payment))).resolves.toBe(REFUND.value);
    expect(payment.status).toBe(PaymentStatus.Compensated);
  });

  describe('a payment that never recorded its debit', () => {
    /** Tests debit recovery when Processing has no recorded movement reference. */
    const stuckInProcessing = (): Payment => {
      const payment = aPayment();
      payment.markProcessing();
      payment.pullEvents();
      return payment;
    };

    it('declines without refunding when the debit never happened', async () => {
      const payment = stuckInProcessing();
      const { handler, payments } = await handlerFor(payment);
      accounts.findMovement.mockResolvedValue(null);

      await expect(handler.execute(command(payment))).resolves.toBeNull();

      // The wallet never lost anything, so crediting it would have invented it.
      expect(accounts.credit).not.toHaveBeenCalled();
      expect(ledger.record).not.toHaveBeenCalled();
      expect(payment.status).toBe(PaymentStatus.Declined);
      expect(payment.failureReason).toBe(FailureReason.ACCOUNTS_UNAVAILABLE);
      expect(payments.statuses).toEqual([PaymentStatus.Declined]);
      expect(events.enqueue).toHaveBeenCalledWith([expect.any(PaymentDeclinedEvent)]);
    });

    it('asks accounts under the payment own debit key', async () => {
      const payment = stuckInProcessing();
      const { handler } = await handlerFor(payment);
      accounts.findMovement.mockResolvedValue(null);

      await handler.execute(command(payment));

      expect(accounts.findMovement).toHaveBeenCalledWith(SOURCE, payment.reference.value);
    });

    it('refunds when the debit had gone through after all', async () => {
      const payment = stuckInProcessing();
      const { handler } = await handlerFor(payment);
      accounts.findMovement.mockResolvedValue(movement(DEBIT));
      accounts.credit.mockResolvedValue(movement(REFUND));

      await expect(handler.execute(command(payment))).resolves.toBe(REFUND.value);

      // The reference the answer carried is recorded, then unwound.
      expect(payment.debitTransactionReference?.value).toBe(DEBIT.value);
      expect(payment.status).toBe(PaymentStatus.Compensated);
      expect(accounts.credit).toHaveBeenCalledWith(
        SOURCE,
        payment.money,
        `${payment.reference.value}:refund`,
        expect.anything(),
      );
    });

    it('decides nothing while accounts cannot be reached', async () => {
      const payment = stuckInProcessing();
      const { handler, payments } = await handlerFor(payment);
      accounts.findMovement.mockRejectedValue(new AccountsUnavailableError('find-movement'));

      await expect(handler.execute(command(payment))).resolves.toBeNull();

      // Still unknown, so still Processing: the next pass asks again rather
      // than committing to an answer nobody has.
      expect(payment.status).toBe(PaymentStatus.Processing);
      expect(payments.saved).toEqual([]);
      expect(accounts.credit).not.toHaveBeenCalled();
    });

    it('does not ask when the aggregate already knows the debit', async () => {
      const payment = aDebitedPayment();
      payment.markCompensationPending(FailureReason.CREDIT_FAILED);
      const { handler } = await handlerFor(payment);
      accounts.credit.mockResolvedValue(movement(REFUND));

      await handler.execute(command(payment));

      expect(accounts.findMovement).not.toHaveBeenCalled();
    });
  });

  it('recovers an applied credit whose response or local commit was lost without refunding', async () => {
    const payment = aDebitedPayment();
    const { handler, payments } = await handlerFor(payment);
    accounts.findMovement.mockResolvedValue(movement(CREDIT));

    await expect(handler.execute(command(payment))).resolves.toBeNull();

    expect(accounts.findMovement).toHaveBeenCalledWith(DESTINATION, payment.movementKey('credit'));
    expect(accounts.credit).not.toHaveBeenCalled();
    expect(payment.status).toBe(PaymentStatus.Approved);
    expect(payments.statuses).toEqual([PaymentStatus.Approved]);
    expect(ledger.record.mock.calls[0][1].map((entry: LedgerMovement) => entry.type)).toEqual([
      'DEBIT',
      'CREDIT',
    ]);
  });

  it.each(['missing', 'unavailable'])('never refunds an uncertain credit: %s', async (outcome) => {
    const payment = aDebitedPayment();
    const { handler, payments } = await handlerFor(payment);
    if (outcome === 'missing') accounts.findMovement.mockResolvedValue(null);
    else accounts.findMovement.mockRejectedValue(new AccountsUnavailableError('find-movement'));

    await handler.execute(command(payment));

    expect(accounts.credit).not.toHaveBeenCalled();
    expect(payments.saved).toEqual([]);
    expect(payment.status).toBe(PaymentStatus.Processing);
  });

  it('waits for a delayed credit to become visible and then approves it', async () => {
    const payment = aDebitedPayment();
    const { handler } = await handlerFor(payment);
    accounts.findMovement.mockResolvedValueOnce(null).mockResolvedValueOnce(movement(CREDIT));
    await handler.execute(command(payment));
    expect(payment.status).toBe(PaymentStatus.Processing);
    await handler.execute(command(payment));
    expect(payment.status).toBe(PaymentStatus.Approved);
    expect(accounts.credit).not.toHaveBeenCalled();
  });

  it('reports a payment that does not exist', async () => {
    const { handler } = await handlerFor(null);

    await expect(
      handler.execute(new CompensatePaymentCommand('pay_01hq3m8x0000zt7k9d2v4bqf1c')),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(accounts.credit).not.toHaveBeenCalled();
  });

  it('never compensates an approved payment', async () => {
    const payment = aDebitedPayment();
    payment.approve(CREDIT);
    payment.pullEvents();
    const { handler, payments } = await handlerFor(payment);
    accounts.credit.mockResolvedValue(movement(REFUND));

    // Reject before issuing any external credit, not only when updating state.
    await expect(handler.execute(command(payment))).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(accounts.credit).not.toHaveBeenCalled();
    expect(payment.status).toBe(PaymentStatus.Approved);
    expect(payments.saved).toEqual([]);
  });
});
