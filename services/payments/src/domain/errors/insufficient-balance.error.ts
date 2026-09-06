import { DomainError } from './domain.error';

export class InsufficientBalanceError extends DomainError {
  constructor(walletReference: string) {
    super(`wallet ${walletReference} does not hold enough funds`, 'INSUFFICIENT_BALANCE', {
      wallet_reference: walletReference,
    });
  }
}
