import { PaymentStatus } from '../model/payment-status';
import { DomainError } from './domain.error';

/** A transition the state machine does not allow. Always a bug, never a user error. */
export class InvalidTransitionError extends DomainError {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`a payment cannot move from ${from} to ${to}`, 'INVALID_TRANSITION', { from, to });
  }
}
