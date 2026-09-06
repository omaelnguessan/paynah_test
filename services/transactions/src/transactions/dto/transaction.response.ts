import { ApiProperty } from '@nestjs/swagger';
import { Currency, TransactionStatus, TransactionType } from '@paynad/shared';
import { Transaction } from '../entities/transaction.entity';

export class TransactionResponse {
  @ApiProperty({ example: 'trx_01hq3m8x0000zt7k9d2v4bqf1c' })
  reference: string;

  @ApiProperty({ example: '9f1c2b7e-4d10-4f2a-9a4c-8f7d3c2b1a05' })
  transaction_id: string;

  @ApiProperty({ example: 'pay_01hq3m8x0000zt7k9d2v4bqf1c' })
  payment_reference: string;

  @ApiProperty({ enum: TransactionType, example: TransactionType.DEBIT })
  type: TransactionType;

  @ApiProperty({ example: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c' })
  wallet_reference: string;

  @ApiProperty({ example: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' })
  user_reference: string;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ enum: Currency, example: Currency.XOF })
  currency: Currency;

  @ApiProperty({ example: 'Paiement facture avril' })
  description: string;

  @ApiProperty({ enum: TransactionStatus, example: TransactionStatus.APPROVED })
  status: TransactionStatus;

  @ApiProperty({ example: '2026-09-06T10:15:00.000Z', description: 'Business time' })
  occurred_at: string;

  @ApiProperty({ example: '2026-09-06T10:15:02.412Z', description: 'Insertion time' })
  recorded_at: string;

  static from(transaction: Transaction): TransactionResponse {
    return {
      reference: transaction.reference,
      transaction_id: transaction.transaction_id,
      payment_reference: transaction.payment_reference,
      type: transaction.type,
      wallet_reference: transaction.wallet_reference,
      user_reference: transaction.user_reference,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      status: transaction.status,
      occurred_at: transaction.occurred_at.toISOString(),
      recorded_at: transaction.recorded_at.toISOString(),
    };
  }
}
