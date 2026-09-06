import { DomainError } from './domain.error';

/**
 * The accounts service could not be reached, or failed in a way that says
 * nothing about the money. Raised only once every retry has been spent.
 */
export class AccountsUnavailableError extends DomainError {
  constructor(operation: string, cause?: string) {
    super(`accounts is unavailable (${operation})`, 'ACCOUNTS_UNAVAILABLE', {
      operation,
      ...(cause ? { cause } : {}),
    });
  }
}
