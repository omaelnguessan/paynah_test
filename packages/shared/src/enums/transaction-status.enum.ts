/** Capitalised on the wire, e.g. `"Pending"`. Never duplicated with `message`. */
export enum TransactionStatus {
  PENDING = 'Pending',
  APPROVED = 'Approved',
  DECLINED = 'Declined',
}

/** Movement direction on the wire. Refunds append a correction to the ledger. */
export enum TransactionType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
  REFUND = 'REFUND',
}

export enum WalletStatus {
  ACTIVE = 'Active',
  FROZEN = 'Frozen',
}
