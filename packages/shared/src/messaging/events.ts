import { Currency, TransactionStatus, TransactionType } from '../enums';

/** Fields present on every event, for tracing and replay safety. */
export interface EventEnvelope {
  /** Caller-supplied idempotency key that started the flow. */
  transaction_id: string;
  /** Correlation id propagated from the inbound HTTP request. */
  correlation_id: string;
  /** ISO 8601 UTC. */
  emitted_at: string;
}

/**
 * `payment.transaction.recorded` — one movement to append to the ledger.
 * Flat and snake_case, exactly like the HTTP fallback body, so the two entry
 * points share a single contract and a single validation.
 */
export interface PaymentTransactionRecordedEvent extends EventEnvelope {
  payment_reference: string;
  type: TransactionType;
  wallet_reference: string;
  user_reference: string;
  amount: number;
  currency: Currency;
  description: string;
  status: TransactionStatus;
  /** Business time of the movement, distinct from the insertion time. */
  occurred_at: string;
}

export interface WalletMovementEvent extends EventEnvelope {
  wallet_reference: string;
  amount: number;
  currency: Currency;
  balance_after: number;
}
