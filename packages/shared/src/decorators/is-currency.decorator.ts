import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { Currency } from '../enums';

/** ISO-4217 alpha code, String(3), constrained to the supported set. */
export function IsCurrency(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ enum: Currency, example: Currency.XOF, maxLength: 3, minLength: 3 }),
    IsString(),
    Length(3, 3),
    IsEnum(Currency, { message: `$property must be one of: ${Object.values(Currency).join(', ')}` }),
  );
}
