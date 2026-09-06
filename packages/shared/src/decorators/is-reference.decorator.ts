import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { referencePattern } from '../constants';
import { ReferencePrefix } from '../enums';

/**
 * A server-generated reference of a given family, e.g. `wlt_01hq3m8x…`.
 * This is the identifier callers query with afterwards.
 */
export function IsReference(prefix: ReferencePrefix): PropertyDecorator {
  const pattern = referencePattern(prefix);
  return applyDecorators(
    ApiProperty({
      type: String,
      example: `${prefix}_01hq3m8x0000zt7k9d2v4bqf1c`,
      pattern: pattern.source,
      description: `Server-generated reference prefixed with \`${prefix}_\``,
    }),
    IsString(),
    Matches(pattern, {
      message: `$property must be a valid reference prefixed with "${prefix}_"`,
    }),
  );
}
