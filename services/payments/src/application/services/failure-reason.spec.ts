import { AccountsUnavailableError } from '../../domain/errors/accounts-unavailable.error';
import { DomainError } from '../../domain/errors/domain.error';
import { InsufficientBalanceError } from '../../domain/errors/insufficient-balance.error';
import { InvalidTransitionError } from '../../domain/errors/invalid-transition.error';
import { PaymentStatus, FailureReason } from '../../domain/model/payment-status';
import {
  CurrencyMismatchError,
  WalletFrozenError,
  WalletNotFoundError,
} from '../../domain/errors/wallet.errors';
import { failureReasonOf } from './failure-reason';

const WALLET = 'wlt_01hq3m8x0000zt7k9d2v4bqf1c';

describe('failureReasonOf', () => {
  it.each<[DomainError, FailureReason]>([
    [new InsufficientBalanceError(WALLET), FailureReason.INSUFFICIENT_BALANCE],
    [new WalletNotFoundError(WALLET), FailureReason.WALLET_NOT_FOUND],
    [new WalletFrozenError(WALLET), FailureReason.WALLET_FROZEN],
    [new CurrencyMismatchError(WALLET), FailureReason.CURRENCY_MISMATCH],
    [new AccountsUnavailableError('debit'), FailureReason.ACCOUNTS_UNAVAILABLE],
  ])('names %p in the payment\'s own vocabulary', (error, expected) => {
    expect(failureReasonOf(error)).toBe(expected);
  });

  it('records anything it cannot name precisely as an upstream failure', () => {
    // Guessing would put a wrong reason in front of a caller; this is honest.
    expect(
      failureReasonOf(new InvalidTransitionError(PaymentStatus.Approved, PaymentStatus.Declined)),
    ).toBe(FailureReason.ACCOUNTS_UNAVAILABLE);
  });
});
