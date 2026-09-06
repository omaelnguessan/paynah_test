import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches, ValidateIf } from 'class-validator';
import {
  Currency,
  IsAmount,
  IsCurrency,
  IsSafeDescription,
  IsTransactionId,
  ReferencePrefix,
  referencePattern,
} from '@paynad/shared';

/** Shared by credit and debit — the two operations differ only in direction. */
export class BalanceOperationRequest {
  @IsTransactionId()
  transaction_id: string;

  @IsAmount()
  amount: number;

  @IsCurrency()
  currency: Currency;

  @IsSafeDescription({ required: true })
  description: string;

  /** Correlates the movement with the payments saga that requested it. */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'pay_01hq3m8x0000zt7k9d2v4bqf1c',
  })
  @applyDecorators(
    IsOptional(),
    ValidateIf((_, value) => value !== null && value !== undefined),
    Matches(referencePattern(ReferencePrefix.PAYMENT), {
      message: 'payment_reference must be a valid reference prefixed with "pay_"',
    }),
  )
  payment_reference?: string | null;
}
