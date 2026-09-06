import { FailureReason } from '../model/payment-status';
import { Money } from '../model/money';
import { Reference } from '../model/reference';
import { DomainEvent } from './domain-event';

export class PaymentDeclinedEvent extends DomainEvent {
  static readonly TYPE = 'payment.declined';

  constructor(
    readonly reference: Reference,
    readonly money: Money,
    readonly reason: FailureReason,
    occurredAt?: Date,
  ) {
    super(reference.value, PaymentDeclinedEvent.TYPE, occurredAt);
  }

  payload(): Record<string, unknown> {
    return {
      payment_reference: this.reference.value,
      amount: this.money.amount,
      currency: this.money.currency,
      failure_reason: this.reason,
    };
  }
}
