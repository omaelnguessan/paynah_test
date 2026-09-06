/**
 * Application codes, carried as String and decoupled from the HTTP status.
 * 4xxx = caller fault, 5xxx = our fault or an upstream one.
 */
export const ResponseCode = {
  SUCCESS: '200',
  CREATED: '201',

  VALIDATION_FAILED: '4000',
  /** Pinned by the contract: an insufficient balance is `"4001"` over a 422. */
  INSUFFICIENT_BALANCE: '4001',
  USER_NOT_FOUND: '4002',
  WALLET_NOT_FOUND: '4003',
  TRANSACTION_NOT_FOUND: '4008',
  WALLET_FROZEN: '4004',
  CURRENCY_MISMATCH: '4005',
  DUPLICATE_TRANSACTION: '4006',
  IDEMPOTENCY_CONFLICT: '4007',

  INTERNAL_ERROR: '5000',
  UPSTREAM_UNAVAILABLE: '5001',
} as const;

export type ResponseCodeValue = (typeof ResponseCode)[keyof typeof ResponseCode];
