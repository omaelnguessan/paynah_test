/**
 * Unwinds a payment whose credit failed after the debit went through.
 * Triggered by the saga, and again by the reconciler for anything left owing.
 */
export class CompensatePaymentCommand {
  constructor(readonly paymentReference: string) {}
}
