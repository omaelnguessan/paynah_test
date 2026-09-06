import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Wallet } from './entities/wallet.entity';
import { LedgerEntryRepository } from './repositories/ledger-entry.repository';
import { WalletRepository } from './repositories/wallet.repository';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, LedgerEntry]), UsersModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletRepository, LedgerEntryRepository],
  exports: [WalletsService],
})
export class WalletsModule {}
