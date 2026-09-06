import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeResponse,
  PaginatedData,
  ReferencePipe,
  ReferencePrefix,
  ResponseCode,
  ResponseMessage,
} from '@paynad/shared';
import { ListTransactionsQuery } from './dto/list-transactions.query';
import { RecordTransactionRequest } from './dto/record-transaction.request';
import { TransactionResponse } from './dto/transaction.response';
import { TransactionsService } from './transactions.service';

/** Only the status setter is needed here, so the platform type is not imported. */
interface ResponseLike {
  status(code: number): unknown;
}

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Record a movement',
    description:
      'Fallback path for the `payment.transaction.recorded` event, and the entry point used by tests. ' +
      'Idempotent on transaction_id: a replay answers 200 with the stored row instead of 201.',
  })
  @ApiEnvelopeResponse({
    status: 201,
    code: ResponseCode.CREATED,
    message: ResponseMessage.CREATED,
    model: TransactionResponse,
    description: 'The movement was appended',
  })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: TransactionResponse,
    description: 'transaction_id already recorded; the stored row is returned unchanged',
  })
  async record(
    @Body() request: RecordTransactionRequest,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<TransactionResponse> {
    const { transaction, created } = await this.transactions.record(request);
    // The envelope's code follows the status: CREATED for a fresh append,
    // SUCCESS for a replay.
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return TransactionResponse.from(transaction);
  }

  @Get()
  @ApiOperation({
    summary: 'Paginated history',
    description: 'Requires user_reference or wallet_reference: the ledger is never scanned whole.',
  })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: TransactionResponse,
    isArray: true,
  })
  @ApiEnvelopeResponse({
    status: 422,
    code: ResponseCode.VALIDATION_FAILED,
    message: ResponseMessage.VALIDATION_FAILED,
    description: 'Neither user_reference nor wallet_reference was supplied',
  })
  history(@Query() query: ListTransactionsQuery): Promise<PaginatedData<TransactionResponse>> {
    return this.transactions.history(query);
  }

  @Get(':reference')
  @ApiOperation({ summary: 'Fetch one movement by reference' })
  @ApiParam({ name: 'reference', example: 'trx_01hq3m8x0000zt7k9d2v4bqf1c' })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: TransactionResponse,
  })
  @ApiEnvelopeResponse({
    status: 404,
    code: ResponseCode.TRANSACTION_NOT_FOUND,
    message: ResponseMessage.TRANSACTION_NOT_FOUND,
  })
  async findOne(
    @Param('reference', new ReferencePipe(ReferencePrefix.TRANSACTION)) reference: string,
  ): Promise<TransactionResponse> {
    return TransactionResponse.from(await this.transactions.findByReference(reference));
  }
}
