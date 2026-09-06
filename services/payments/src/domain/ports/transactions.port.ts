import { Payment } from '../model/payment';
import { Reference } from '../model/reference';

/** One movement to hand to the ledger service. */
export interface LedgerMovement {
  transactionId: string;
  paymentReference: Reference;
  type: 'DEBIT' | 'CREDIT' | 'REFUND';
  wallet: Reference;
  movementReference: Reference;
  occurredAt: Date;
}

/**
 * The ledger, from the domain's point of view. Notifying it is asynchronous and
 * at-least-once, so an implementation writes to the outbox rather than calling
 * the broker inline.
 */
export interface TransactionsPort {
  record(payment: Payment, movements: readonly LedgerMovement[]): Promise<void>;
}

export const TRANSACTIONS_PORT = Symbol('TRANSACTIONS_PORT');
