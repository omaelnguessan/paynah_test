/**
 * The read side. Queries never hydrate the `Payment` aggregate: they read a
 * denormalised projection whose shape is driven by what the API returns, so the
 * write model can change without breaking a single query.
 */
export interface PaymentView {
  reference: string;
  transaction_id: string;
  amount: number;
  currency: string;
  description: string;
  source_wallet_reference: string;
  destination_wallet_reference: string;
  status: string;
  failure_reason: string | null;
  debit_transaction_reference: string | null;
  credit_transaction_reference: string | null;
  refund_transaction_reference: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface PaymentViewFilter {
  status?: string | null;
  sourceWallet?: string | null;
  page: number;
  perPage: number;
}

export interface PaymentReadPort {
  findByReference(reference: string): Promise<PaymentView | null>;
  findPage(filter: PaymentViewFilter): Promise<{ items: PaymentView[]; total: number }>;
}

export const PAYMENT_READ_PORT = Symbol('PAYMENT_READ_PORT');
