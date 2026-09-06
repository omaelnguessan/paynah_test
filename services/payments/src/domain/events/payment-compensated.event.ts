import { Money } from '../model/money';
import { Reference } from '../model/reference';
import { DomainEvent } from './domain-event';

/** The source was debited and then refunded: the payment left no net movement. */
export class PaymentCompensatedEvent extends DomainEvent {
  static readonly TYPE = 'payment.compensated';

  constructor(
    readonly reference: Reference,
    readonly money: Money,
    readonly refundTransactionReference: Reference,
    occurredAt?: Date,
  ) {
    super(reference.value, PaymentCompensatedEvent.TYPE, occurredAt);
  }

  payload(): Record<string, unknown> {
    return {
      payment_reference: this.reference.value,
      amount: this.money.amount,
      currency: this.money.currency,
      refund_transaction_reference: this.refundTransactionReference.value,
    };
  }
}
