import { DomainError } from './domain.error';

export class ConcurrentPaymentError extends DomainError {
  constructor(reference: string) {
    super('payment is already being processed or has changed', 'PAYMENT_CONFLICT', { reference });
  }
}
