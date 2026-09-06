import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, DeclinedReason, TransactionStatus } from '@paynad/shared';
import { LedgerEntry } from '../entities/ledger-entry.entity';

export class BalanceOperationResponse {
  @ApiProperty({ example: '9f1c2b7e-4d10-4f2a-9a4c-8f7d3c2b1a05', description: 'Echoed idempotency key' })
  transaction_id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
    description: 'Reference of the movement, or null when nothing was written',
  })
  reference: string | null;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ enum: Currency, example: Currency.XOF })
  currency: Currency;

  @ApiProperty({ example: 150000 })
  balance_before: number;

  @ApiProperty({ example: 145000 })
  balance_after: number;

  @ApiProperty({
    enum: [TransactionStatus.APPROVED, TransactionStatus.DECLINED],
    example: TransactionStatus.APPROVED,
  })
  status: TransactionStatus.APPROVED | TransactionStatus.DECLINED;

  @ApiPropertyOptional({ enum: DeclinedReason, nullable: true, example: null })
  declined_reason: DeclinedReason | null;

  static approved(entry: LedgerEntry): BalanceOperationResponse {
    return {
      transaction_id: entry.transaction_id,
      reference: entry.reference,
      amount: entry.amount,
      currency: entry.currency,
      balance_before: entry.balance_before,
      balance_after: entry.balance_after,
      status: TransactionStatus.APPROVED,
      declined_reason: null,
    };
  }

  /**
   * A declined operation writes nothing, so it has no movement reference and
   * the balance is unchanged on both sides. It travels in `data` of the error
   * envelope rather than as a success.
   */
  static declined(
    request: { transaction_id: string; amount: number; currency: Currency },
    balance: number,
    reason: DeclinedReason,
  ): BalanceOperationResponse {
    return {
      transaction_id: request.transaction_id,
      reference: null,
      amount: request.amount,
      currency: request.currency,
      balance_before: balance,
      balance_after: balance,
      status: TransactionStatus.DECLINED,
      declined_reason: reason,
    };
  }
}
