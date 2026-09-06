import { Body, Controller, Get, HttpCode, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import 'reflect-metadata';
import { IsAmount, IsTransactionId } from '../decorators';
import { ApiResponse } from '../dto/api-response.dto';
import { ResponseCode } from '../enums/response-code.enum';
import { ResponseMessage } from '../enums/response-message.enum';
import { InsufficientBalanceException } from '../exceptions/app.exception';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import { createValidationPipe } from '../pipes/validation.pipe';
import { AllExceptionsFilter } from './all-exceptions.filter';

class DebitDto {
  @IsTransactionId()
  transaction_id: string;

  @IsAmount()
  amount: number;
}

@Controller('probe')
class ProbeController {
  @Get('value')
  value(): { balance: number } {
    return { balance: 100 };
  }

  @Get('void')
  nothing(): void {}

  @Get('own-envelope')
  ownEnvelope(): ApiResponse<null> {
    return ApiResponse.of(ResponseCode.DUPLICATE_TRANSACTION, ResponseMessage.DUPLICATE_TRANSACTION, null);
  }

  @Get('domain-failure')
  domainFailure(): never {
    throw new InsufficientBalanceException({ wallet_reference: 'wlt_x', missing: 500 });
  }

  @Get('boom')
  boom(): never {
    throw new Error('an unexpected leak');
  }

  @Post('debit')
  @HttpCode(201)
  debit(@Body() body: DebitDto): DebitDto {
    return body;
  }
}

describe('response envelope', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const envelopeKeys = ['code', 'message', 'data'];

  it('wraps a plain return value', async () => {
    const response = await request(app.getHttpServer()).get('/probe/value').expect(200);
    expect(Object.keys(response.body).sort()).toEqual(envelopeKeys.sort());
    expect(response.body).toEqual({
      code: ResponseCode.SUCCESS,
      message: ResponseMessage.SUCCESS,
      data: { balance: 100 },
    });
    expect(typeof response.body.code).toBe('string');
  });

  it('turns an empty return value into an explicit null payload', async () => {
    const response = await request(app.getHttpServer()).get('/probe/void').expect(200);
    expect(response.body.data).toBeNull();
  });

  it('passes through an envelope the handler built itself', async () => {
    const response = await request(app.getHttpServer()).get('/probe/own-envelope').expect(200);
    expect(response.body.message).toBe(ResponseMessage.DUPLICATE_TRANSACTION);
    expect(response.body.code).toBe(ResponseCode.DUPLICATE_TRANSACTION);
  });

  it('uses CREATED for a 201 handler', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/debit')
      .send({ transaction_id: 'a1b2c3d4-e5f6', amount: 500 })
      .expect(201);
    expect(response.body.code).toBe(ResponseCode.CREATED);
    expect(response.body.message).toBe(ResponseMessage.CREATED);
  });

  it('reports a domain failure with its applicative code and payload', async () => {
    const response = await request(app.getHttpServer()).get('/probe/domain-failure').expect(422);
    expect(response.body).toEqual({
      code: ResponseCode.INSUFFICIENT_BALANCE,
      message: ResponseMessage.INSUFFICIENT_BALANCE,
      data: { wallet_reference: 'wlt_x', missing: 500 },
    });
  });

  it('lists the faulty fields on a validation failure', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/debit')
      .send({ transaction_id: 'nope', amount: 3 })
      .expect(400);
    expect(response.body.code).toBe(ResponseCode.VALIDATION_FAILED);
    expect(response.body.message).toBe(ResponseMessage.VALIDATION_FAILED);
    expect(response.body.data.map((entry: { field: string }) => entry.field).sort()).toEqual([
      'amount',
      'transaction_id',
    ]);
  });

  it('never leaks an unexpected error outside the envelope', async () => {
    const response = await request(app.getHttpServer()).get('/probe/boom').expect(500);
    expect(response.body).toEqual({
      code: ResponseCode.INTERNAL_ERROR,
      message: ResponseMessage.INTERNAL_ERROR,
      data: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('an unexpected leak');
  });

  it('keeps an unknown route inside the envelope too', async () => {
    const response = await request(app.getHttpServer()).get('/does-not-exist').expect(404);
    expect(response.body).toEqual({
      code: ResponseCode.VALIDATION_FAILED,
      message: ResponseMessage.VALIDATION_FAILED,
      data: null,
    });
  });
});
