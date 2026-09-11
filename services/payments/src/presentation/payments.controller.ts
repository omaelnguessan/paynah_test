import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeResponse,
  StrictThrottle,
  PaginatedData,
  ReferencePrefix,
  ReferencePipe,
  ResponseCode,
  ResponseMessage,
  resolvePagination,
} from '@paynad/shared';
import { ListPaymentsQuery } from '../application/queries/list-payments.query';
import { ListPaymentsResult } from '../application/handlers/queries/list-payments.handler';
import { GetPaymentByReferenceQuery } from '../application/queries/get-payment-by-reference.query';
import { InitiatePaymentResult } from '../application/handlers/commands/initiate-payment.handler';
import { PaymentView } from '../domain/ports/payment-read.port';
import { ListPaymentsRequestQuery } from './dto/list-payments.query';
import { InitiatePaymentRequest } from './dto/initiate-payment.request';
import { PaymentResponse } from './dto/payment.response';
import { PaymentMapper } from './mappers/payment.mapper';

/**
 * Buses in, DTOs out. There is no business logic here and no repository: the
 * controller maps the request to a command, and maps the read model to a
 * response. That is the whole job.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}


  @StrictThrottle()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initiate a payment',
    description:
      'Idempotent on transaction_id. The command returns only a reference; the response is then ' +
      'built by the read side, so the write and read paths stay visibly separate.',
  })
  @ApiEnvelopeResponse({
    status: 201,
    code: ResponseCode.CREATED,
    message: ResponseMessage.CREATED,
    model: PaymentResponse,
    description:
      'The payment exists, whatever its outcome: read `status` for Approved, Declined ' +
      '(with failure_reason) or Compensated. A refusal is not an error envelope — the ' +
      'caller keeps the reference it needs to reconcile.',
  })
  @ApiEnvelopeResponse({
    status: 409,
    code: ResponseCode.IDEMPOTENCY_CONFLICT,
    message: ResponseMessage.IDEMPOTENCY_CONFLICT,
    description: 'transaction_id replayed with a different payload',
  })
  @ApiEnvelopeResponse({
    status: 422,
    code: ResponseCode.VALIDATION_FAILED,
    message: ResponseMessage.VALIDATION_FAILED,
    description: 'The source and destination wallets are the same',
  })
  async initiate(@Body() request: InitiatePaymentRequest): Promise<PaymentResponse> {
    const { reference } = await this.commands.execute<
      ReturnType<typeof PaymentMapper.toCommand>,
      InitiatePaymentResult
    >(PaymentMapper.toCommand(request));

    return this.byReference(reference);
  }

  @Get()
  @ApiOperation({ summary: 'List payments (admin)' })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: PaymentResponse,
    isArray: true,
  })
  async list(
    @Query() query: ListPaymentsRequestQuery,
  ): Promise<PaginatedData<PaymentResponse>> {
    const { page, perPage } = resolvePagination(query);
    const result = await this.queries.execute<ListPaymentsQuery, ListPaymentsResult>(
      new ListPaymentsQuery(page, perPage, query.status ?? null, query.source_wallet_reference ?? null),
    );

    return new PaginatedData(result.items.map(PaymentMapper.toResponse), page, perPage, result.total);
  }

  @Get(':reference')
  @ApiOperation({ summary: 'Read the state of a payment' })
  @ApiParam({ name: 'reference', example: 'pay_01hq3m8x0000zt7k9d2v4bqf1c' })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: PaymentResponse,
  })
  @ApiEnvelopeResponse({
    status: 404,
    code: ResponseCode.TRANSACTION_NOT_FOUND,
    message: ResponseMessage.TRANSACTION_NOT_FOUND,
  })
  findOne(
    @Param('reference', new ReferencePipe(ReferencePrefix.PAYMENT)) reference: string,
  ): Promise<PaymentResponse> {
    return this.byReference(reference);
  }

  private async byReference(reference: string): Promise<PaymentResponse> {
    const view = await this.queries.execute<GetPaymentByReferenceQuery, PaymentView>(
      new GetPaymentByReferenceQuery(reference),
    );
    return PaymentMapper.toResponse(view);
  }
}
