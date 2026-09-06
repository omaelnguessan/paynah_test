import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  AMOUNT_MAX,
  AMOUNT_STEP,
  Currency,
  IsCurrency,
  IsReference,
  ReferencePrefix,
} from '@paynad/shared';

function optional(...rules: PropertyDecorator[]): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    ValidateIf((_, value) => value !== null && value !== undefined),
    ...rules,
  );
}

export class CreateWalletRequest {
  @IsReference(ReferencePrefix.USER)
  user_reference: string;

  @IsCurrency()
  currency: Currency;

  /**
   * Opening balance. `null` or absent means zero. Unlike a movement it may be
   * exactly 0, but it is still an integer multiple of the amount step.
   */
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    multipleOf: AMOUNT_STEP,
    example: 0,
  })
  @optional(
    IsInt({ message: 'initial_balance must be an integer in the smallest currency unit' }),
    Min(0),
    Max(AMOUNT_MAX),
  )
  initial_balance?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Compte principal' })
  @optional(IsString(), MaxLength(100))
  label?: string | null;
}
