/** Capitalised on the wire, e.g. `"Pending"`. Never duplicated with `message`. */
export enum TransactionStatus {
  PENDING = 'Pending',
  APPROVED = 'Approved',
  DECLINED = 'Declined',
}

/**
 * Direction of a movement, upper case on the wire.
 *
 * A ledger is append-only, so a correction is never an amendment: it is a new
 * `REFUND` row that offsets the original.
 */
export enum TransactionType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
  REFUND = 'REFUND',
}

export enum WalletStatus {
  ACTIVE = 'Active',
  FROZEN = 'Frozen',
}
