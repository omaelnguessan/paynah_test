import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, ValidateIf } from 'class-validator';
import {
  Currency,
  IsAmount,
  IsCurrency,
  IsReference,
  IsSafeDescription,
  IsTransactionId,
  ReferencePrefix,
} from '@paynad/shared';

export enum Lang {
  FR = 'fr',
  EN = 'en',
}

/**
 * The HTTP contract, and only that. It carries the validation and the Swagger
 * schema; it is mapped to an `InitiatePaymentCommand` before it reaches the
 * application layer, which never sees a decorator.
 */
export class InitiatePaymentRequest {
  @IsTransactionId()
  transaction_id: string;

  @IsReference(ReferencePrefix.WALLET)
  source_wallet_reference: string;

  @IsReference(ReferencePrefix.WALLET)
  destination_wallet_reference: string;

  @IsAmount()
  amount: number;

  @IsCurrency()
  currency: Currency;

  @IsSafeDescription({ required: true })
  description: string;

  @ApiProperty({ enum: Lang, example: Lang.FR })
  @IsEnum(Lang, { message: `lang must be one of: ${Object.values(Lang).join(', ')}` })
  lang: Lang;

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: { type: 'string' },
    example: { user_reference: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' },
    description: 'Flat string-to-string map carried through to the ledger',
  })
  @applyDecorators(
    IsOptional(),
    ValidateIf((_, value) => value !== null && value !== undefined),
    IsObject(),
  )
  metadata?: Record<string, string> | null;
}
