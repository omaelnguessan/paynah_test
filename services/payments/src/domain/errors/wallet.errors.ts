import { DomainError } from './domain.error';

export class WalletNotFoundError extends DomainError {
  constructor(walletReference: string) {
    super(`wallet ${walletReference} does not exist`, 'WALLET_NOT_FOUND', {
      wallet_reference: walletReference,
    });
  }
}

export class WalletFrozenError extends DomainError {
  constructor(walletReference: string) {
    super(`wallet ${walletReference} is frozen`, 'WALLET_FROZEN', {
      wallet_reference: walletReference,
    });
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(walletReference: string) {
    super(`wallet ${walletReference} is held in another currency`, 'CURRENCY_MISMATCH', {
      wallet_reference: walletReference,
    });
  }
}

/** A payment must move money between two different wallets. */
export class SameWalletError extends DomainError {
  constructor(walletReference: string) {
    super('the source and destination wallets must differ', 'SAME_WALLET', {
      wallet_reference: walletReference,
    });
  }
}
