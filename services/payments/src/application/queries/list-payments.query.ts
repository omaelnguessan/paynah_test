export class ListPaymentsQuery {
  constructor(
    readonly page: number,
    readonly perPage: number,
    readonly status: string | null = null,
    readonly sourceWallet: string | null = null,
  ) {}
}
