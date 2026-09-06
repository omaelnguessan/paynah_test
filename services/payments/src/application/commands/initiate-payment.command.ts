import { Currency } from '../../domain/model/money';

/**
 * A business intention, expressed as plain data. No decorator, no framework:
 * it is neither the HTTP request that triggered it nor the entity it will
 * produce, and the mapping between the three is always explicit.
 */
export class InitiatePaymentCommand {
  constructor(
    readonly transactionId: string,
    readonly sourceWallet: string,
    readonly destinationWallet: string,
    readonly amount: number,
    readonly currency: Currency,
    readonly description: string,
    readonly lang: 'fr' | 'en',
    readonly metadata: Record<string, string> | null,
  ) {}
}
