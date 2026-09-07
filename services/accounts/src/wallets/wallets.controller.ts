import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeResponse,
  InternalThrottle,
  StrictThrottle,
  ReferencePipe,
  ReferencePrefix,
  ResponseCode,
  ResponseMessage,
} from '@paynad/shared';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { MovementNotFoundException } from './wallets.exceptions';
import { BalanceOperationRequest } from './dto/balance-operation.request';
import { BalanceOperationResponse } from './dto/balance-operation.response';
import { BalanceResponse } from './dto/balance.response';
import { CreateWalletRequest } from './dto/create-wallet.request';
import { WalletResponse } from './dto/wallet.response';
import { WalletsService } from './wallets.service';

const WALLET_REFERENCE = {
  name: 'reference',
  example: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c',
  description: 'Wallet reference',
};

/** Documents the failures every balance operation shares. */
function MovementFailures(): MethodDecorator {
  return applyDecorators(
    ApiEnvelopeResponse({
      status: 401,
      code: ResponseCode.VALIDATION_FAILED,
      message: ResponseMessage.VALIDATION_FAILED,
      description: 'Missing or invalid x-api-key / x-api-secret',
    }),
    ApiEnvelopeResponse({
      status: 404,
      code: ResponseCode.WALLET_NOT_FOUND,
      message: ResponseMessage.WALLET_NOT_FOUND,
    }),
    ApiEnvelopeResponse({
      status: 409,
      code: ResponseCode.IDEMPOTENCY_CONFLICT,
      message: ResponseMessage.IDEMPOTENCY_CONFLICT,
      description: 'transaction_id replayed with a different body',
    }),
    ApiEnvelopeResponse({
      status: 422,
      code: ResponseCode.WALLET_FROZEN,
      message: ResponseMessage.WALLET_FROZEN,
      model: BalanceOperationResponse,
      description: 'Declined; data carries the Declined operation',
    }),
    ApiEnvelopeResponse({
      status: 422,
      code: ResponseCode.CURRENCY_MISMATCH,
      message: ResponseMessage.CURRENCY_MISMATCH,
      model: BalanceOperationResponse,
      description: 'Declined; data carries the Declined operation',
    }),
  );
}

@ApiTags('accounts')
@Controller('accounts')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  // Opening wallets in bulk costs us rows and costs the caller nothing.
  @StrictThrottle()
  @Post()
  @ApiOperation({ summary: 'Create a wallet for a user' })
  @ApiEnvelopeResponse({
    status: 201,
    code: ResponseCode.CREATED,
    message: ResponseMessage.CREATED,
    model: WalletResponse,
  })
  @ApiEnvelopeResponse({
    status: 404,
    code: ResponseCode.USER_NOT_FOUND,
    message: ResponseMessage.USER_NOT_FOUND,
  })
  async create(@Body() request: CreateWalletRequest): Promise<WalletResponse> {
    const { wallet, user_reference } = await this.wallets.create(request);
    return WalletResponse.from(wallet, user_reference);
  }

  @Get(':reference/balance')
  @ApiOperation({ summary: 'Read a wallet balance' })
  @ApiParam(WALLET_REFERENCE)
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: BalanceResponse,
  })
  @ApiEnvelopeResponse({
    status: 404,
    code: ResponseCode.WALLET_NOT_FOUND,
    message: ResponseMessage.WALLET_NOT_FOUND,
  })
  async balance(
    @Param('reference', new ReferencePipe(ReferencePrefix.WALLET)) reference: string,
  ): Promise<BalanceResponse> {
    const { wallet, user_reference } = await this.wallets.getWithOwner(reference);
    return BalanceResponse.from(wallet, user_reference);
  }

  @Get(':reference/movements/:transaction_id')
  @InternalThrottle()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: '[internal] Look up a movement by its idempotency key',
    description:
      'The read an orchestrator needs after losing the answer to a credit or a debit: it ' +
      'says whether the key already moved money on this wallet, and it never moves any itself.',
  })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiHeader({ name: 'x-api-secret', required: true })
  @ApiParam(WALLET_REFERENCE)
  @ApiParam({ name: 'transaction_id', example: 'pay_01hq3m8x0000zt7k9d2v4bqf1c' })
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: BalanceOperationResponse,
    description: 'The key produced this movement',
  })
  @ApiEnvelopeResponse({
    status: 404,
    code: ResponseCode.TRANSACTION_NOT_FOUND,
    message: ResponseMessage.TRANSACTION_NOT_FOUND,
    description: 'This key has never moved money on this wallet',
  })
  @ApiEnvelopeResponse({
    status: 401,
    code: ResponseCode.VALIDATION_FAILED,
    message: ResponseMessage.VALIDATION_FAILED,
    description: 'Missing or invalid x-api-key / x-api-secret',
  })
  async movement(
    @Param('reference', new ReferencePipe(ReferencePrefix.WALLET)) reference: string,
    @Param('transaction_id') transactionId: string,
  ): Promise<BalanceOperationResponse> {
    const entry = await this.wallets.findMovement(reference, transactionId);
    if (!entry) {
      throw new MovementNotFoundException({ reference, transaction_id: transactionId });
    }
    return BalanceOperationResponse.approved(entry);
  }

  @Post(':reference/credit')
  @HttpCode(HttpStatus.OK)
  @InternalThrottle()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: '[internal] Credit a wallet',
    description:
      'Idempotent on (wallet, transaction_id): replaying a key returns the original movement.',
  })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiHeader({ name: 'x-api-secret', required: true })
  @ApiParam(WALLET_REFERENCE)
  @MovementFailures()
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: BalanceOperationResponse,
  })
  credit(
    @Param('reference', new ReferencePipe(ReferencePrefix.WALLET)) reference: string,
    @Body() request: BalanceOperationRequest,
  ): Promise<BalanceOperationResponse> {
    return this.wallets.credit(reference, request);
  }

  @Post(':reference/debit')
  @HttpCode(HttpStatus.OK)
  @InternalThrottle()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: '[internal] Debit a wallet',
    description:
      'Idempotent on (wallet, transaction_id): replaying a key returns the original movement.',
  })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiHeader({ name: 'x-api-secret', required: true })
  @ApiParam(WALLET_REFERENCE)
  @MovementFailures()
  @ApiEnvelopeResponse({
    status: 200,
    code: ResponseCode.SUCCESS,
    message: ResponseMessage.SUCCESS,
    model: BalanceOperationResponse,
  })
  @ApiEnvelopeResponse({
    status: 422,
    code: ResponseCode.INSUFFICIENT_BALANCE,
    message: ResponseMessage.INSUFFICIENT_BALANCE,
    model: BalanceOperationResponse,
    description: 'Declined; no movement was written',
  })
  debit(
    @Param('reference', new ReferencePipe(ReferencePrefix.WALLET)) reference: string,
    @Body() request: BalanceOperationRequest,
  ): Promise<BalanceOperationResponse> {
    return this.wallets.debit(reference, request);
  }
}
