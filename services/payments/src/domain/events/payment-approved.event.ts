import { Money } from '../model/money';
import { Reference } from '../model/reference';
import { DomainEvent } from './domain-event';

export class PaymentApprovedEvent extends DomainEvent {
  static readonly TYPE = 'payment.approved';

  constructor(
    readonly reference: Reference,
    readonly money: Money,
    readonly debitTransactionReference: Reference,
    readonly creditTransactionReference: Reference,
    occurredAt?: Date,
  ) {
    super(reference.value, PaymentApprovedEvent.TYPE, occurredAt);
  }

  payload(): Record<string, unknown> {
    return {
      payment_reference: this.reference.value,
      amount: this.money.amount,
      currency: this.money.currency,
      debit_transaction_reference: this.debitTransactionReference.value,
      credit_transaction_reference: this.creditTransactionReference.value,
    };
  }
}
