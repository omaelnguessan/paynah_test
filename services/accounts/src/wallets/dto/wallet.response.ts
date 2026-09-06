import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, WalletStatus } from '@paynad/shared';
import { Wallet } from '../entities/wallet.entity';

export class WalletResponse {
  @ApiProperty({ example: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c' })
  reference: string;

  @ApiProperty({ example: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' })
  user_reference: string;

  @ApiProperty({ enum: Currency, example: Currency.XOF })
  currency: Currency;

  @ApiProperty({ example: 0 })
  balance: number;

  @ApiProperty({ example: 0 })
  available_balance: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Compte principal' })
  label: string | null;

  @ApiProperty({ enum: WalletStatus, example: WalletStatus.ACTIVE })
  status: WalletStatus;

  @ApiProperty({ example: '2026-09-06T10:15:00.000Z', description: 'ISO 8601 UTC' })
  created_at: string;

  static from(wallet: Wallet, userReference: string): WalletResponse {
    return {
      reference: wallet.reference,
      user_reference: userReference,
      currency: wallet.currency,
      balance: wallet.balance,
      available_balance: wallet.balance - wallet.reserved_amount,
      label: wallet.label,
      status: wallet.status,
      created_at: wallet.created_at.toISOString(),
    };
  }
}
