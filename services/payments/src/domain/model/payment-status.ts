export enum PaymentStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Approved = 'Approved',
  Declined = 'Declined',
  Compensated = 'Compensated',
  CompensationPending = 'CompensationPending',
}

/** Allowed payment state transitions. Unlisted transitions are rejected. */
export const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  // Nothing has been attempted yet: the payment can start, or be refused outright.
  [PaymentStatus.Pending]: [PaymentStatus.Processing, PaymentStatus.Declined],
  // The source has been debited: it can complete, be refused, or need unwinding.
  [PaymentStatus.Processing]: [
    PaymentStatus.Approved,
    PaymentStatus.Declined,
    PaymentStatus.Compensated,
    PaymentStatus.CompensationPending,
  ],
  // The refund is owed but has not gone through; only the reconciler moves this on.
  [PaymentStatus.CompensationPending]: [PaymentStatus.Compensated],
  // Terminal.
  [PaymentStatus.Approved]: [],
  [PaymentStatus.Declined]: [],
  [PaymentStatus.Compensated]: [],
};

export const TERMINAL_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.Approved,
  PaymentStatus.Declined,
  PaymentStatus.Compensated,
];

/** Why a payment did not go through. Machine-readable, and never a HTTP code. */
export enum FailureReason {
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  WALLET_FROZEN = 'WALLET_FROZEN',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  ACCOUNTS_UNAVAILABLE = 'ACCOUNTS_UNAVAILABLE',
  CREDIT_FAILED = 'CREDIT_FAILED',
}
