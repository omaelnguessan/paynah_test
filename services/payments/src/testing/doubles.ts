import { Currency, Money } from '../domain/model/money';
import { Payment } from '../domain/model/payment';
import { PaymentStatus } from '../domain/model/payment-status';
import { Reference } from '../domain/model/reference';
import {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyStatus,
} from '../domain/ports/idempotency.repository';
import { PaymentRepository } from '../domain/ports/payment.repository';
import { TransactionRunner } from '../domain/ports/transaction-runner.port';

/**
 * Test doubles for the ports the application layer talks to.
 *
 * They live outside `domain/` and `application/` on purpose: the layers under
 * test import nothing from here, so the architecture rules stay true and the
 * coverage figures stay honest.
 */

export const SOURCE = Reference.of('wlt', 'wlt_01hq3m8x0000zt7k9d2v4bqf1c');
export const DESTINATION = Reference.of('wlt', 'wlt_01hq3m8x0000zt7k9d2v4bqf9z');
export const DEBIT = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqf1c');
export const CREDIT = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqf9z');
export const REFUND = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqfaa');

export function aPayment(overrides: Partial<{ amount: number; description: string }> = {}): Payment {
  return Payment.initiate({
    transactionId: 'tx-00000001',
    money: Money.of(overrides.amount ?? 5_000, Currency.XOF),
    source: SOURCE,
    destination: DESTINATION,
    description: overrides.description ?? 'Paiement facture avril',
    metadata: null,
  });
}

/** A payment carried through the saga up to, and including, the debit. */
export function aDebitedPayment(): Payment {
  const payment = aPayment();
  payment.markProcessing();
  payment.markDebited(DEBIT);
  payment.pullEvents();
  return payment;
}

/** Runs the unit of work inline: what commits together is asserted elsewhere. */
export const inlineTransaction: TransactionRunner = { run: (work) => work() };

export function movement(reference: Reference, balanceAfter = 5_000) {
  return { transactionReference: reference, balanceAfter };
}

/** Keeps whatever the handler saved, so a spec can read the final state back. */
export class InMemoryPaymentRepository implements PaymentRepository {
  readonly saved: Payment[] = [];
  /** Captured at save time: the aggregate keeps moving after it is written. */
  readonly statuses: PaymentStatus[] = [];

  constructor(private readonly stored: Payment | null = null) {}

  save(payment: Payment): Promise<void> {
    this.saved.push(payment);
    this.statuses.push(payment.status);
    return Promise.resolve();
  }

  findByReference(): Promise<Payment | null> {
    return Promise.resolve(this.stored);
  }

  findByTransactionId(): Promise<Payment | null> {
    return Promise.resolve(this.stored);
  }

  findStuck(): Promise<Payment[]> {
    return Promise.resolve([]);
  }
}

/** The real claim semantics — insert-first, unique key — without a database. */
export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly rows = new Map<string, IdempotencyRecord>();

  claim(key: string, requestHash: string): Promise<boolean> {
    if (this.rows.has(key)) {
      return Promise.resolve(false);
    }
    this.rows.set(key, {
      key,
      requestHash,
      status: IdempotencyStatus.IN_PROGRESS,
      paymentReference: null,
      responseBody: null,
    });
    return Promise.resolve(true);
  }

  find(key: string): Promise<IdempotencyRecord | null> {
    return Promise.resolve(this.rows.get(key) ?? null);
  }

  complete(
    key: string,
    paymentReference: string,
    responseBody: Record<string, unknown>,
  ): Promise<void> {
    const row = this.rows.get(key);
    if (row) {
      this.rows.set(key, {
        ...row,
        status: IdempotencyStatus.COMPLETED,
        paymentReference,
        responseBody,
      });
    }
    return Promise.resolve();
  }

  release(key: string): Promise<void> {
    this.rows.delete(key);
    return Promise.resolve();
  }

  get size(): number {
    return this.rows.size;
  }
}
