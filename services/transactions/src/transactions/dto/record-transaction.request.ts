import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsISO8601 } from 'class-validator';
import {
  Currency,
  IsAmount,
  IsCurrency,
  IsReference,
  IsSafeDescription,
  IsTransactionId,
  ReferencePrefix,
  TransactionStatus,
  TransactionType,
} from '@paynad/shared';

/**
 * One movement to append. The AMQP event carries exactly this shape, so the
 * queue and the HTTP fallback share a single contract and a single validation.
 */
export class RecordTransactionRequest {
  @IsTransactionId()
  transaction_id: string;

  @IsReference(ReferencePrefix.PAYMENT)
  payment_reference: string;

  @ApiProperty({ enum: TransactionType, example: TransactionType.DEBIT })
  @IsEnum(TransactionType, {
    message: `type must be one of: ${Object.values(TransactionType).join(', ')}`,
  })
  type: TransactionType;

  @IsReference(ReferencePrefix.WALLET)
  wallet_reference: string;

  @IsReference(ReferencePrefix.USER)
  user_reference: string;

  @IsAmount()
  amount: number;

  @IsCurrency()
  currency: Currency;

  @IsSafeDescription({ required: true })
  description: string;

  @ApiProperty({
    enum: [TransactionStatus.APPROVED, TransactionStatus.DECLINED],
    example: TransactionStatus.APPROVED,
  })
  @IsEnum(TransactionStatus, {
    message: `status must be one of: ${TransactionStatus.APPROVED}, ${TransactionStatus.DECLINED}`,
  })
  status: TransactionStatus.APPROVED | TransactionStatus.DECLINED;

  @ApiProperty({
    example: '2026-09-06T10:15:00.000Z',
    description: 'Business time of the movement, ISO 8601 UTC — not the insertion time',
  })
  @IsISO8601({ strict: true }, { message: 'occurred_at must be an ISO 8601 UTC timestamp' })
  occurred_at: string;
}
