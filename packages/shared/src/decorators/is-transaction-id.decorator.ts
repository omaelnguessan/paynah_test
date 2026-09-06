import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import {
  TRANSACTION_ID_MAX_LENGTH,
  TRANSACTION_ID_MIN_LENGTH,
  TRANSACTION_ID_REGEX,
} from '../constants';

/**
 * Caller-supplied identifier, used as the idempotency key.
 * Distinct from the server-generated `reference`.
 */
export function IsTransactionId(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      type: String,
      minLength: TRANSACTION_ID_MIN_LENGTH,
      maxLength: TRANSACTION_ID_MAX_LENGTH,
      example: '9f1c2b7e-4d10-4f2a-9a4c-8f7d3c2b1a05',
      description: 'Caller-supplied idempotency key (alphanumeric and dashes)',
    }),
    IsString(),
    Matches(TRANSACTION_ID_REGEX, {
      message: `$property must be ${TRANSACTION_ID_MIN_LENGTH}-${TRANSACTION_ID_MAX_LENGTH} characters of [A-Za-z0-9:_-]`,
    }),
  );
}
