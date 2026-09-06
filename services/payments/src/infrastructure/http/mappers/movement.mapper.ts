import { Reference } from '../../../domain/model/reference';
import { MovementResult } from '../../../domain/ports/accounts.port';

/** The envelope `accounts` answers with. Known only to this layer. */
export interface AccountsEnvelope<T> {
  code: string;
  message: string;
  data: T | null;
}

export interface BalanceOperationPayload {
  transaction_id: string;
  reference: string | null;
  amount: number;
  currency: string;
  balance_before: number;
  balance_after: number;
  status: string;
  declined_reason: string | null;
}

/**
 * Translates the external contract into the domain's own words. Nothing from
 * `accounts` — not a field name, not a status — escapes past this function.
 */
export function toMovementResult(payload: BalanceOperationPayload): MovementResult {
  if (!payload.reference) {
    throw new Error('accounts approved a movement without returning its reference');
  }
  return {
    transactionReference: Reference.of('trx', payload.reference),
    balanceAfter: payload.balance_after,
  };
}
