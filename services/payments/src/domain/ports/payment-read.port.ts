import { Currency } from '../model/money';
import { FailureReason, PaymentStatus } from '../model/payment-status';

/**
 * The read side. Queries never hydrate the `Payment` aggregate: they read a
 * projection whose fields are named the way the domain names things, not the
 * way the HTTP contract spells them.
 *
 * That distinction matters. An earlier version of this interface carried
 * `transaction_id` and `source_wallet_reference` — the wire format, in layer 0
 * — which quietly made the domain depend on the shape of a JSON response. The
 * translation belongs to the presentation mapper, and it now happens there.
 */
export interface PaymentView {
  reference: string;
  transactionId: string;
  amount: number;
  currency: Currency;
  description: string;
  sourceWallet: string;
  destinationWallet: string;
  status: PaymentStatus;
  failureReason: FailureReason | null;
  debitTransactionReference: string | null;
  creditTransactionReference: string | null;
  refundTransactionReference: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface PaymentViewFilter {
  status?: PaymentStatus | null;
  sourceWallet?: string | null;
  page: number;
  perPage: number;
}

export interface PaymentReadPort {
  findByReference(reference: string): Promise<PaymentView | null>;
  findPage(filter: PaymentViewFilter): Promise<{ items: PaymentView[]; total: number }>;
}

export const PAYMENT_READ_PORT = Symbol('PAYMENT_READ_PORT');
