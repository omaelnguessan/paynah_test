import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, Matches, ValidateIf } from 'class-validator';
import { DESCRIPTION_MAX_LENGTH, SAFE_DESCRIPTION_REGEX } from '../constants';

export interface SafeDescriptionOptions {
  /** When true the field must be present and non-empty. Defaults to false. */
  required?: boolean;
}

const SWAGGER = {
  type: String,
  maxLength: DESCRIPTION_MAX_LENGTH,
  example: 'Paiement facture avril',
  description: 'Whitelisted characters only; # / $ _ & are refused',
};

/**
 * Free-text description restricted to a whitelist: letters, digits, spaces and
 * a short punctuation set. `# / $ _ &` are rejected.
 *
 * Optional by default, and then an explicit `null` is accepted as readily as an
 * absent field. `{ required: true }` makes it mandatory and non-empty.
 */
export function IsSafeDescription(options: SafeDescriptionOptions = {}): PropertyDecorator {
  const presence: PropertyDecorator[] = options.required
    ? [ApiProperty(SWAGGER), IsString(), IsNotEmpty()]
    : [
        ApiPropertyOptional({ ...SWAGGER, nullable: true }),
        IsOptional(),
        // Skips every rule below on an explicit null, which is a valid absence.
        ValidateIf((_, value) => value !== null && value !== undefined),
        IsString(),
      ];

  return applyDecorators(
    ...presence,
    MaxLength(DESCRIPTION_MAX_LENGTH),
    Matches(SAFE_DESCRIPTION_REGEX, {
      message: '$property contains forbidden characters (# / $ _ & are not allowed)',
    }),
  );
}
