/** Queues consumed by each service. One queue per consumer, never shared. */
export const Queue = {
  TRANSACTIONS: 'transactions.events',
  PAYMENTS: 'payments.events',
} as const;

/** Event names carried as the `pattern` of a RabbitMQ message. */
export const EventPattern = {
  TRANSACTION_RECORDED: 'payment.transaction.recorded',
  PAYMENT_APPROVED: 'payment.approved',
  PAYMENT_DECLINED: 'payment.declined',
  WALLET_DEBITED: 'wallet.debited',
  WALLET_CREDITED: 'wallet.credited',
} as const;

export type EventPatternValue = (typeof EventPattern)[keyof typeof EventPattern];
