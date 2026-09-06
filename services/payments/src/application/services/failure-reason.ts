import { DomainError } from '../../domain/errors/domain.error';
import { FailureReason } from '../../domain/model/payment-status';

const BY_CODE: Readonly<Record<string, FailureReason>> = {
  INSUFFICIENT_BALANCE: FailureReason.INSUFFICIENT_BALANCE,
  WALLET_NOT_FOUND: FailureReason.WALLET_NOT_FOUND,
  WALLET_FROZEN: FailureReason.WALLET_FROZEN,
  CURRENCY_MISMATCH: FailureReason.CURRENCY_MISMATCH,
  ACCOUNTS_UNAVAILABLE: FailureReason.ACCOUNTS_UNAVAILABLE,
};

/**
 * Why the payment failed, in the payment's own vocabulary. Anything the domain
 * cannot name precisely is recorded as an upstream failure rather than guessed at.
 */
export function failureReasonOf(error: DomainError): FailureReason {
  return BY_CODE[error.code] ?? FailureReason.ACCOUNTS_UNAVAILABLE;
}
