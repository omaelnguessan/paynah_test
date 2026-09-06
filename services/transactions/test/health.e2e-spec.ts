import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  AllExceptionsFilter,
  ResponseInterceptor,
  ResponseCode,
  ResponseMessage,
  createValidationPipe,
} from '@paynad/shared';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';

/**
 * Boots the real HTTP stack of the transactions service — global pipe, interceptor and
 * filter included — against a stubbed connection, so the envelope is checked
 * without needing a live database.
 */
describe('transactions health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: getDataSourceToken(),
          useValue: { query: async () => [{ '?column?': 1 }] },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers GET /health inside the response envelope', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.code).toBe(ResponseCode.SUCCESS);
    expect(response.body.message).toBe(ResponseMessage.SUCCESS);
    expect(response.body.data).toMatchObject({
      service: 'transactions',
      status: 'Healthy',
      database: 'up',
    });
  });

  it('keeps an unknown route inside the envelope', async () => {
    const response = await request(app.getHttpServer()).get('/unknown').expect(404);

    expect(response.body).toEqual({
      code: ResponseCode.VALIDATION_FAILED,
      message: ResponseMessage.VALIDATION_FAILED,
      data: null,
    });
  });
});
