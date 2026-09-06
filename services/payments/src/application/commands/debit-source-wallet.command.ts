/** Saga step 3: take the money out of the source wallet. */
export class DebitSourceWalletCommand {
  constructor(readonly paymentReference: string) {}
}
