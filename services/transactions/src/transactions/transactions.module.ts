import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity';
import { TransactionRepository } from './repositories/transaction.repository';
import { TransactionsController } from './transactions.controller';
import { TransactionsEventsController } from './transactions.events-controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction])],
  controllers: [TransactionsController, TransactionsEventsController],
  providers: [TransactionsService, TransactionRepository],
  exports: [TransactionsService],
})
export class TransactionsModule {}
