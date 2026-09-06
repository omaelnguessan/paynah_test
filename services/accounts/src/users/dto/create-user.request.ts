import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** ISO 3166-1 alpha-2, e.g. CI, BF, FR. */
const COUNTRY_REGEX = /^[A-Z]{2}$/;
/** E.164-ish: an optional +, then 8 to 15 digits. */
const PHONE_REGEX = /^\+?[0-9]{8,15}$/;
const NAME_REGEX = /^[\p{L}][\p{L} '-]{0,99}$/u;

/**
 * An optional field accepts an explicit `null` exactly like an absent key, so a
 * caller can send a complete object with holes in it. The rules that follow are
 * skipped entirely in that case.
 */
function optional(...rules: PropertyDecorator[]): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    ValidateIf((_, value) => value !== null && value !== undefined),
    ...rules,
  );
}

export class CreateUserRequest {
  @ApiProperty({ example: 'Awa' })
  @IsString()
  @IsNotEmpty()
  @Matches(NAME_REGEX, { message: 'customer_firstname contains forbidden characters' })
  customer_firstname: string;

  @ApiProperty({ example: 'Traoré' })
  @IsString()
  @IsNotEmpty()
  @Matches(NAME_REGEX, { message: 'customer_lastname contains forbidden characters' })
  customer_lastname: string;

  @ApiProperty({ example: 'awa.traore@example.com', description: 'Unique across the service' })
  @IsEmail({}, { message: 'customer_email must be a valid email address' })
  @MaxLength(320)
  customer_email: string;

  @ApiProperty({ example: '+2250700000000' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'customer_phone_number must be 8 to 15 digits, optionally prefixed with +' })
  customer_phone_number: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Rue des Jardins, Cocody' })
  @optional(IsString(), MaxLength(255))
  customer_address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Abidjan' })
  @optional(IsString(), MaxLength(100))
  customer_city?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'CI', description: 'ISO 3166-1 alpha-2' })
  @optional(
    IsString(),
    Length(2, 2),
    Matches(COUNTRY_REGEX, { message: 'customer_country must be an ISO 3166-1 alpha-2 code, e.g. CI' }),
  )
  customer_country?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '01BP1234' })
  @optional(IsString(), MaxLength(16))
  customer_zip_code?: string | null;
}
