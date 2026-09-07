import { PaymentStatus } from '../../domain/model/payment-status';

export class ListPaymentsQuery {
  constructor(
    readonly page: number,
    readonly perPage: number,
    readonly status: PaymentStatus | null = null,
    readonly sourceWallet: string | null = null,
  ) {}
}
