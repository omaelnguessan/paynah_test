import { InvalidTransitionError } from '../errors/invalid-transition.error';
import { SameWalletError } from '../errors/wallet.errors';
import { PaymentApprovedEvent } from '../events/payment-approved.event';
import { PaymentCompensatedEvent } from '../events/payment-compensated.event';
import { PaymentDeclinedEvent } from '../events/payment-declined.event';
import { Currency, Money } from './money';
import { Payment } from './payment';
import { ALLOWED_TRANSITIONS, FailureReason, PaymentStatus } from './payment-status';
import { Reference } from './reference';

/**
 * The whole state machine, exercised with no database, no HTTP and no Nest —
 * which is the point of keeping the aggregate free of all three.
 */
const SOURCE = Reference.of('wlt', 'wlt_01hq3m8x0000zt7k9d2v4bqf1c');
const DESTINATION = Reference.of('wlt', 'wlt_01hq3m8x0000zt7k9d2v4bqf9z');
const DEBIT = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqf1c');
const CREDIT = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqf9z');
const REFUND = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqfaa');

function initiate(): Payment {
  return Payment.initiate({
    transactionId: 'tx-00000001',
    money: Money.of(5_000, Currency.XOF),
    source: SOURCE,
    destination: DESTINATION,
    description: 'Paiement facture avril',
    metadata: null,
  });
}

/** Drives a payment to the given state through legal transitions only. */
function at(status: PaymentStatus): Payment {
  const payment = initiate();
  switch (status) {
    case PaymentStatus.Pending:
      return payment;
    case PaymentStatus.Processing:
      payment.markProcessing();
      return payment;
    case PaymentStatus.Approved:
      payment.markProcessing();
      payment.markDebited(DEBIT);
      payment.approve(CREDIT);
      return payment;
    case PaymentStatus.Declined:
      payment.decline(FailureReason.INSUFFICIENT_BALANCE);
      return payment;
    case PaymentStatus.CompensationPending:
      payment.markProcessing();
      payment.markDebited(DEBIT);
      payment.markCompensationPending(FailureReason.CREDIT_FAILED);
      return payment;
    case PaymentStatus.Compensated:
      payment.markProcessing();
      payment.markDebited(DEBIT);
      payment.compensate(REFUND);
      return payment;
  }
}

describe('Payment', () => {
  describe('initiate', () => {
    it('starts Pending with its own reference and no events yet', () => {
      const payment = initiate();

      expect(payment.status).toBe(PaymentStatus.Pending);
      expect(payment.reference.value).toMatch(/^pay_[0-9a-hjkmnp-tv-z]{26}$/);
      expect(payment.completedAt).toBeNull();
      expect(payment.pullEvents()).toEqual([]);
    });

    it('refuses to move money to the wallet it came from', () => {
      expect(() =>
        Payment.initiate({
          transactionId: 'tx-00000001',
          money: Money.of(5_000, Currency.XOF),
          source: SOURCE,
          destination: SOURCE,
          description: 'Circular',
          metadata: null,
        }),
      ).toThrow(SameWalletError);
    });
  });

  describe('the transition table', () => {
    const everyStatus = Object.values(PaymentStatus);

    it.each(everyStatus)('lists %s explicitly', (status) => {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    });

    it.each([PaymentStatus.Approved, PaymentStatus.Declined, PaymentStatus.Compensated])(
      '%s is terminal',
      (status) => {
        expect(ALLOWED_TRANSITIONS[status]).toEqual([]);
      },
    );

    it('refuses every transition the table does not list', () => {
      const attempts: Array<[PaymentStatus, PaymentStatus, (p: Payment) => void]> = [
        [PaymentStatus.Pending, PaymentStatus.Approved, (p) => p.approve(CREDIT)],
        [PaymentStatus.Pending, PaymentStatus.Compensated, (p) => p.compensate(REFUND)],
        [PaymentStatus.Approved, PaymentStatus.Declined, (p) => p.decline(FailureReason.CREDIT_FAILED)],
        [PaymentStatus.Approved, PaymentStatus.Processing, (p) => p.markProcessing()],
        [PaymentStatus.Declined, PaymentStatus.Processing, (p) => p.markProcessing()],
        [PaymentStatus.Declined, PaymentStatus.Compensated, (p) => p.compensate(REFUND)],
        [PaymentStatus.Compensated, PaymentStatus.Approved, (p) => p.approve(CREDIT)],
        [PaymentStatus.Processing, PaymentStatus.Processing, (p) => p.markProcessing()],
      ];

      for (const [from, , attempt] of attempts) {
        expect(() => attempt(at(from))).toThrow(InvalidTransitionError);
      }
    });

    it('allows a payment to be declined before anything was attempted', () => {
      const payment = at(PaymentStatus.Pending);
      expect(() => payment.decline(FailureReason.WALLET_NOT_FOUND)).not.toThrow();
    });

    it('only moves CompensationPending on to Compensated', () => {
      const payment = at(PaymentStatus.CompensationPending);

      expect(() => payment.approve(CREDIT)).toThrow(InvalidTransitionError);
      expect(() => payment.decline(FailureReason.CREDIT_FAILED)).toThrow(InvalidTransitionError);
      expect(() => payment.compensate(REFUND)).not.toThrow();
    });
  });

  describe('approval', () => {
    it('records the movements, completes, and raises one event', () => {
      const payment = at(PaymentStatus.Approved);

      expect(payment.status).toBe(PaymentStatus.Approved);
      expect(payment.debitTransactionReference?.value).toBe(DEBIT.value);
      expect(payment.creditTransactionReference?.value).toBe(CREDIT.value);
      expect(payment.completedAt).toBeInstanceOf(Date);

      const events = payment.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PaymentApprovedEvent);
      expect(events[0].payload()).toMatchObject({
        payment_reference: payment.reference.value,
        amount: 5_000,
      });
    });

    it('cannot be approved without a recorded debit', () => {
      const payment = initiate();
      payment.markProcessing();

      expect(() => payment.approve(CREDIT)).toThrow(InvalidTransitionError);
    });

    it('refuses a debit reference before the payment is processing', () => {
      expect(() => initiate().markDebited(DEBIT)).toThrow(InvalidTransitionError);
    });
  });

  describe('events', () => {
    it('hands them over exactly once', () => {
      const payment = at(PaymentStatus.Approved);

      expect(payment.pullEvents()).toHaveLength(1);
      expect(payment.pullEvents()).toHaveLength(0);
    });

    it('raises a declined event carrying the reason', () => {
      const payment = at(PaymentStatus.Declined);
      const [event] = payment.pullEvents();

      expect(event).toBeInstanceOf(PaymentDeclinedEvent);
      expect(event.payload()).toMatchObject({
        failure_reason: FailureReason.INSUFFICIENT_BALANCE,
      });
    });

    it('raises a compensated event carrying the refund', () => {
      const payment = at(PaymentStatus.Compensated);
      const [event] = payment.pullEvents();

      expect(event).toBeInstanceOf(PaymentCompensatedEvent);
      expect(event.payload()).toMatchObject({
        refund_transaction_reference: REFUND.value,
      });
    });
  });

  describe('idempotency keys', () => {
    it('gives each leg of the saga its own, derived from the reference', () => {
      const payment = initiate();

      expect(payment.movementKey('debit')).toBe(payment.reference.value);
      expect(payment.movementKey('credit')).toBe(`${payment.reference.value}:credit`);
      expect(payment.movementKey('refund')).toBe(`${payment.reference.value}:refund`);
    });
  });

  describe('restore', () => {
    it('round-trips through a snapshot without raising events', () => {
      const original = at(PaymentStatus.Approved);
      const snapshot = original.toSnapshot();

      const restored = Payment.restore(snapshot);

      expect(restored.toSnapshot()).toEqual(snapshot);
      expect(restored.pullEvents()).toEqual([]);
    });
  });
});
