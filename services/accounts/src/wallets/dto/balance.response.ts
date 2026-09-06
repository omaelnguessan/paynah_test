import { ApiProperty } from '@nestjs/swagger';
import { Currency, WalletStatus } from '@paynad/shared';
import { Wallet } from '../entities/wallet.entity';

export class BalanceResponse {
  @ApiProperty({ example: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c' })
  reference: string;

  @ApiProperty({ example: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' })
  user_reference: string;

  @ApiProperty({ enum: Currency, example: Currency.XOF })
  currency: Currency;

  @ApiProperty({ example: 150000, description: 'Integer, smallest currency unit' })
  balance: number;

  @ApiProperty({ example: 150000, description: 'balance minus the amount held by in-flight operations' })
  available_balance: number;

  @ApiProperty({ enum: WalletStatus, example: WalletStatus.ACTIVE })
  status: WalletStatus;

  static from(wallet: Wallet, userReference: string): BalanceResponse {
    return {
      reference: wallet.reference,
      user_reference: userReference,
      currency: wallet.currency,
      balance: wallet.balance,
      available_balance: wallet.balance - wallet.reserved_amount,
      status: wallet.status,
    };
  }
}
