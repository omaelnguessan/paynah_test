import { Money } from '../model/money';
import { Reference } from '../model/reference';

/** What the domain learns from a movement — no HTTP status, no external DTO. */
export interface MovementResult {
  /** The `trx_…` reference of the movement `accounts` recorded. */
  transactionReference: Reference;
  balanceAfter: number;
}

/** What travels with a movement beyond the money itself. */
export interface MovementDetails {
  description: string;
  /** Ties the movement back to the payment that caused it. */
  paymentReference: Reference;
}

/**
 * The domain's view of the accounts service.
 *
 * The signature is expressed entirely in domain types. An implementation that
 * speaks HTTP translates 4xx and 5xx into domain errors before they get here,
 * so no layer above ever sees a status code.
 */
export interface AccountsPort {
  debit(
    wallet: Reference,
    money: Money,
    idempotencyKey: string,
    details: MovementDetails,
  ): Promise<MovementResult>;
  credit(
    wallet: Reference,
    money: Money,
    idempotencyKey: string,
    details: MovementDetails,
  ): Promise<MovementResult>;
  /**
   * Has this key already moved money on this wallet?
   *
   * The saga needs it after losing an answer: "the debit never happened" and
   * "the debit happened and the response was lost" demand opposite repairs, and
   * only the service that owns the balance can tell them apart. `null` means
   * the key produced nothing; an error means we still do not know.
   */
  findMovement(wallet: Reference, idempotencyKey: string): Promise<MovementResult | null>;
}

export const ACCOUNTS_PORT = Symbol('ACCOUNTS_PORT');
