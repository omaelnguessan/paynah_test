/** Saga step 5: put the money into the destination wallet. */
export class CreditDestinationWalletCommand {
  constructor(readonly paymentReference: string) {}
}
