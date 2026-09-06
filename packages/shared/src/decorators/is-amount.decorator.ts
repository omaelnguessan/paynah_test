import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  ValidationOptions,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';
import { AMOUNT_MAX, AMOUNT_MIN, AMOUNT_STEP } from '../constants';
import { isValidAmount } from '../utils/amount.util';

function IsAmountRule(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isAmount',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isValidAmount(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an integer between ${AMOUNT_MIN} and ${AMOUNT_MAX}, multiple of ${AMOUNT_STEP}`;
        },
      },
    });
  };
}

/**
 * Monetary amount in the currency's minor unit: Integer, >= 5, multiple of 5.
 * Never a float — no rounding is ever performed on the way in.
 */
export function IsAmount(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      type: Number,
      example: 5000,
      minimum: AMOUNT_MIN,
      multipleOf: AMOUNT_STEP,
      description: 'Integer amount in the smallest currency unit, multiple of 5',
    }),
    // Deliberately no `@Type(() => Number)`: a string amount is a caller bug,
    // not something to coerce silently.
    IsAmountRule(),
  );
}
