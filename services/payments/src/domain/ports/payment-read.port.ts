import { Currency } from '../model/money';
import { FailureReason, PaymentStatus } from '../model/payment-status';

/** Read projection using domain field names. Queries do not hydrate Payment aggregates. */
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
