import { ViewColumn, ViewEntity } from 'typeorm';

/**
 * The read model: a SQL view, mapped to the shape the API returns.
 *
 * It is a view rather than a table maintained by a projector because there is
 * no second write path to keep in sync and no window where a caller could read
 * a payment the write model has already moved on from. What matters for CQRS is
 * that the read side has its own contract and never hydrates the aggregate —
 * and when a join arrives, it lands here without touching a single query.
 */
@ViewEntity({
  name: 'payment_read_model',
  expression: `
    SELECT p.reference,
           p.transaction_id,
           p.amount,
           p.currency,
           p.description,
           p.source_wallet_reference,
           p.destination_wallet_reference,
           p.status,
           p.failure_reason,
           p.debit_transaction_reference,
           p.credit_transaction_reference,
           p.refund_transaction_reference,
           p.created_at,
           p.completed_at
      FROM payments p
  `,
})
export class PaymentReadModel {
  @ViewColumn()
  reference: string;

  @ViewColumn()
  transaction_id: string;

  @ViewColumn()
  amount: string;

  @ViewColumn()
  currency: string;

  @ViewColumn()
  description: string;

  @ViewColumn()
  source_wallet_reference: string;

  @ViewColumn()
  destination_wallet_reference: string;

  @ViewColumn()
  status: string;

  @ViewColumn()
  failure_reason: string | null;

  @ViewColumn()
  debit_transaction_reference: string | null;

  @ViewColumn()
  credit_transaction_reference: string | null;

  @ViewColumn()
  refund_transaction_reference: string | null;

  @ViewColumn()
  created_at: Date;

  @ViewColumn()
  completed_at: Date | null;
}
