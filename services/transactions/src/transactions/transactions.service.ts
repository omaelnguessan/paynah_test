import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  FieldErrorDto,
  PaginatedData,
  ReferencePrefix,
  ResponseCode,
  ResponseMessage,
  TransactionNotFoundException,
  generateReference,
  isUniqueViolation,
  resolvePagination,
} from '@paynad/shared';
import { ListTransactionsQuery } from './dto/list-transactions.query';
import { RecordTransactionRequest } from './dto/record-transaction.request';
import { TransactionResponse } from './dto/transaction.response';
import { Transaction } from './entities/transaction.entity';
import { TransactionRepository } from './repositories/transaction.repository';

/** Whether the movement was appended now, or already known. */
export interface RecordOutcome {
  transaction: Transaction;
  created: boolean;
}

/**
 * A history query with no reference filter would scan the whole ledger, so it
 * is refused. 422 rather than 400: the query is well formed, it is just not
 * something this service is willing to answer.
 */
export class UnscopedHistoryException extends AppException {
  constructor() {
    super(
      ResponseCode.VALIDATION_FAILED,
      ResponseMessage.VALIDATION_FAILED,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        new FieldErrorDto('user_reference', [
          'at least one of user_reference or wallet_reference is required',
        ]),
        new FieldErrorDto('wallet_reference', [
          'at least one of user_reference or wallet_reference is required',
        ]),
      ],
    );
  }
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly transactions: TransactionRepository) {}

  /**
   * Idempotent on `transaction_id`, enforced by a unique constraint rather than
   * by the preliminary lookup — two concurrent deliveries of the same event
   * both pass that lookup, and the constraint settles which one wins.
   */
  async record(request: RecordTransactionRequest): Promise<RecordOutcome> {
    const known = await this.transactions.findByTransactionId(request.transaction_id);
    if (known) {
      return { transaction: known, created: false };
    }

    try {
      const transaction = await this.transactions.append({
        reference: generateReference(ReferencePrefix.TRANSACTION),
        transaction_id: request.transaction_id,
        payment_reference: request.payment_reference,
        type: request.type,
        wallet_reference: request.wallet_reference,
        user_reference: request.user_reference,
        amount: request.amount,
        currency: request.currency,
        description: request.description,
        status: request.status,
        occurred_at: new Date(request.occurred_at),
      });
      return { transaction, created: true };
    } catch (error) {
      if (!isUniqueViolation(error, 'uq_transactions_transaction_id')) {
        throw error;
      }
      const winner = await this.transactions.findByTransactionId(request.transaction_id);
      if (!winner) {
        throw error;
      }
      this.logger.log(`concurrent replay of ${request.transaction_id}, returning the stored row`);
      return { transaction: winner, created: false };
    }
  }

  async history(query: ListTransactionsQuery): Promise<PaginatedData<TransactionResponse>> {
    if (!query.user_reference && !query.wallet_reference) {
      throw new UnscopedHistoryException();
    }

    const pagination = resolvePagination(query);
    const [rows, total] = await this.transactions.findPage(
      {
        user_reference: query.user_reference,
        wallet_reference: query.wallet_reference,
        type: query.type,
      },
      pagination,
    );

    return new PaginatedData(
      rows.map(TransactionResponse.from),
      pagination.page,
      pagination.perPage,
      total,
    );
  }

  async findByReference(reference: string): Promise<Transaction> {
    const transaction = await this.transactions.findByReference(reference);
    if (!transaction) {
      throw new TransactionNotFoundException({ reference });
    }
    return transaction;
  }
}
