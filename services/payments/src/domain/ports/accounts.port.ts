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

/** Accounts operations expressed in domain types; adapters translate transport errors. */
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
   * Looks up a recorded movement by idempotency key.
   * Returns null if none is currently visible; an in-flight request may still complete.
   * Throws when the outcome cannot be read.
   */
  findMovement(wallet: Reference, idempotencyKey: string): Promise<MovementResult | null>;
}

export const ACCOUNTS_PORT = Symbol('ACCOUNTS_PORT');
