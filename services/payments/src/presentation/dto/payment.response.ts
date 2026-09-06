import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@paynad/shared';
import { PaymentStatus } from '../../domain/model/payment-status';

/** The outbound HTTP contract. Built from the read model, never from the aggregate. */
export class PaymentResponse {
  @ApiProperty({ example: 'pay_01hq3m8x0000zt7k9d2v4bqf1c' })
  reference: string;

  @ApiProperty({ example: '9f1c2b7e-4d10-4f2a-9a4c-8f7d3c2b1a05' })
  transaction_id: string;

  @ApiProperty({ example: 5000 })
  amount: number;

  @ApiProperty({ enum: Currency, example: Currency.XOF })
  currency: Currency;

  @ApiProperty({ example: 'Paiement facture avril' })
  description: string;

  @ApiProperty({ example: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c' })
  source_wallet_reference: string;

  @ApiProperty({ example: 'wlt_01hq3m8x0000zt7k9d2v4bqf9z' })
  destination_wallet_reference: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.Approved })
  status: PaymentStatus;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  failure_reason: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'trx_01hq3m8x0000zt7k9d2v4bqf1c' })
  debit_transaction_reference: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'trx_01hq3m8x0000zt7k9d2v4bqf9z' })
  credit_transaction_reference: string | null;

  @ApiProperty({ example: '2026-09-06T10:15:00.000Z', description: 'ISO 8601 UTC' })
  created_at: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-09-06T10:15:02.412Z' })
  completed_at: string | null;
}
