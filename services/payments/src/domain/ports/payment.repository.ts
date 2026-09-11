import { Payment } from '../model/payment';
import { PaymentStatus } from '../model/payment-status';
import { Reference } from '../model/reference';

export interface PaymentRepository {
  save(payment: Payment): Promise<void>;
  findByReference(reference: Reference): Promise<Payment | null>;
  findByTransactionId(transactionId: string): Promise<Payment | null>;
  recordRecoveryAttempt(reference: Reference, error: string | null): Promise<number>;
  /** Feeds the reconciler: payments stuck in a non-terminal state. */
  findStuck(statuses: readonly PaymentStatus[], olderThan: Date, limit: number): Promise<Payment[]>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
