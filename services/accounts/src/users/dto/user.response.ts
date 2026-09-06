import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../entities/user.entity';

export class UserResponse {
  @ApiProperty({ example: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' })
  reference: string;

  @ApiProperty({ example: 'Awa' })
  customer_firstname: string;

  @ApiProperty({ example: 'Traoré' })
  customer_lastname: string;

  @ApiProperty({ example: 'awa.traore@example.com' })
  customer_email: string;

  @ApiProperty({ example: '+2250700000000' })
  customer_phone_number: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  customer_address: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  customer_city: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  customer_country: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  customer_zip_code: string | null;

  @ApiProperty({ example: '2026-09-06T10:15:00.000Z', description: 'ISO 8601 UTC' })
  created_at: string;

  /** Flat, snake_case, and never exposing the internal uuid. */
  static from(user: User): UserResponse {
    return {
      reference: user.reference,
      customer_firstname: user.customer_firstname,
      customer_lastname: user.customer_lastname,
      customer_email: user.customer_email,
      customer_phone_number: user.customer_phone_number,
      customer_address: user.customer_address,
      customer_city: user.customer_city,
      customer_country: user.customer_country,
      customer_zip_code: user.customer_zip_code,
      created_at: user.created_at.toISOString(),
    };
  }
}
