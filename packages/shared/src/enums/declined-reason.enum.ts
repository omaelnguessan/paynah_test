/**
 * Why a balance operation was refused. Mirrors the `ResponseMessage` of the
 * failure so a caller can branch on the payload without parsing the envelope.
 */
export enum DeclinedReason {
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  WALLET_FROZEN = 'WALLET_FROZEN',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
}
