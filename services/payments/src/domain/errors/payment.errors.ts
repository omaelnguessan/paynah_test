import { DomainError } from './domain.error';

export class PaymentNotFoundError extends DomainError {
  constructor(reference: string) {
    super(`payment ${reference} does not exist`, 'PAYMENT_NOT_FOUND', { reference });
  }
}

/** The same idempotency key replayed with a different payload. */
export class IdempotencyConflictError extends DomainError {
  constructor(key: string) {
    super(`idempotency key ${key} was already used with a different payload`, 'IDEMPOTENCY_CONFLICT', {
      transaction_id: key,
    });
  }
}

/** The same idempotency key replayed while the first attempt is still running. */
export class RequestInProgressError extends DomainError {
  constructor(key: string) {
    super(`a request with idempotency key ${key} is still in progress`, 'REQUEST_IN_PROGRESS', {
      transaction_id: key,
    });
  }
}
