import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AllExceptionsFilter,
  Currency,
  ResponseCode,
  ResponseInterceptor,
  ReferencePrefix,
  ResponseMessage,
  TransactionStatus,
  TransactionType,
  createValidationPipe,
  generateReference,
} from '@paynad/shared';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Runs against the real database: the idempotency constraint, the composite
 * indexes and the append-only trigger are the point, so stubbing Postgres out
 * would test nothing. Needs `make up && make migrate`.
 */
describe('transactions (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;

  const stamp = Date.now();
  // Fresh references per run, so a re-run never collides with earlier rows.
  const user = generateReference(ReferencePrefix.USER);
  const wallet = generateReference(ReferencePrefix.WALLET);

  const movement = (overrides: Record<string, unknown> = {}) => ({
    transaction_id: `e2e-${stamp}-${Math.random().toString(36).slice(2, 10)}`,
    payment_reference: 'pay_01hq3m8x0000zt7k9d2v4bqf1c',
    type: TransactionType.DEBIT,
    wallet_reference: wallet,
    user_reference: user,
    amount: 5_000,
    currency: Currency.XOF,
    description: 'Paiement facture avril',
    status: TransactionStatus.APPROVED,
    occurred_at: '2026-09-06T10:15:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('recording', () => {
    it('appends a movement with a trx_ reference and two distinct timestamps', async () => {
      const body = movement();
      const response = await http.post('/transactions').send(body).expect(201);

      expect(response.body.code).toBe(ResponseCode.CREATED);
      expect(response.body.data.reference).toMatch(/^trx_[0-9a-hjkmnp-tv-z]{26}$/);
      expect(response.body.data.occurred_at).toBe(body.occurred_at);
      expect(response.body.data.recorded_at).not.toBe(body.occurred_at);
      expect(new Date(response.body.data.recorded_at).getTime()).toBeGreaterThan(
        new Date(body.occurred_at).getTime(),
      );
    });

    it('answers 200 with the stored row on a replay', async () => {
      const body = movement();
      const first = await http.post('/transactions').send(body).expect(201);
      const replay = await http.post('/transactions').send(body).expect(200);

      expect(replay.body.code).toBe(ResponseCode.SUCCESS);
      expect(replay.body.data).toEqual(first.body.data);
    });

    it('records a movement exactly once under concurrent delivery', async () => {
      const body = movement();
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () => http.post('/transactions').send(body)),
      );

      const references = new Set(attempts.map((attempt) => attempt.body.data.reference));
      expect(references.size).toBe(1);
      expect(attempts.filter((attempt) => attempt.status === 201)).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === 200)).toHaveLength(9);
    });

    it('lists every faulty field of a malformed movement', async () => {
      const response = await http
        .post('/transactions')
        .send(movement({ amount: 7, type: 'SIDEWAYS', occurred_at: 'yesterday' }))
        .expect(400);

      expect(response.body.data.map((entry: { field: string }) => entry.field).sort()).toEqual([
        'amount',
        'occurred_at',
        'type',
      ]);
    });
  });

  describe('history', () => {
    const scopedUser = generateReference(ReferencePrefix.USER);
    const scopedWallet = generateReference(ReferencePrefix.WALLET);

    beforeAll(async () => {
      // Three movements an hour apart, appended out of chronological order so
      // the ordering assertion is about occurred_at and not insertion order.
      for (const hour of ['12', '10', '11']) {
        await http
          .post('/transactions')
          .send(
            movement({
              user_reference: scopedUser,
              wallet_reference: scopedWallet,
              type: hour === '11' ? TransactionType.REFUND : TransactionType.DEBIT,
              occurred_at: `2026-09-06T${hour}:00:00.000Z`,
            }),
          )
          .expect(201);
      }
    });

    it('refuses a query scoped to neither a user nor a wallet', async () => {
      const response = await http.get('/transactions').expect(422);

      expect(response.body.code).toBe(ResponseCode.VALIDATION_FAILED);
      expect(response.body.message).toBe(ResponseMessage.VALIDATION_FAILED);
      expect(response.body.data.map((entry: { field: string }) => entry.field)).toEqual([
        'user_reference',
        'wallet_reference',
      ]);
    });

    it('refuses a full scan even when a type filter is supplied', async () => {
      await http.get('/transactions').query({ type: TransactionType.REFUND }).expect(422);
    });

    it('returns newest business time first', async () => {
      const response = await http
        .get('/transactions')
        .query({ user_reference: scopedUser })
        .expect(200);

      expect(response.body.data.items.map((item: { occurred_at: string }) => item.occurred_at)).toEqual(
        [
          '2026-09-06T12:00:00.000Z',
          '2026-09-06T11:00:00.000Z',
          '2026-09-06T10:00:00.000Z',
        ],
      );
    });

    it('paginates with per_page and has_next', async () => {
      const first = await http
        .get('/transactions')
        .query({ user_reference: scopedUser, per_page: 2 })
        .expect(200);

      expect(first.body.data).toMatchObject({ page: 1, per_page: 2, total: 3, has_next: true });
      expect(first.body.data.items).toHaveLength(2);

      const second = await http
        .get('/transactions')
        .query({ user_reference: scopedUser, per_page: 2, page: 2 })
        .expect(200);

      expect(second.body.data).toMatchObject({ page: 2, per_page: 2, total: 3, has_next: false });
      expect(second.body.data.items).toHaveLength(1);
    });

    it('filters by type within a scope', async () => {
      const response = await http
        .get('/transactions')
        .query({ user_reference: scopedUser, type: TransactionType.REFUND })
        .expect(200);

      expect(response.body.data.total).toBe(1);
      expect(response.body.data.items[0].type).toBe(TransactionType.REFUND);
    });

    it('rejects a per_page beyond the cap', async () => {
      const response = await http
        .get('/transactions')
        .query({ user_reference: scopedUser, per_page: 500 })
        .expect(400);

      expect(response.body.data[0].field).toBe('per_page');
    });
  });

  describe('detail', () => {
    it('fetches one movement by reference', async () => {
      const created = await http.post('/transactions').send(movement()).expect(201);
      const response = await http
        .get(`/transactions/${created.body.data.reference}`)
        .expect(200);

      expect(response.body.data).toEqual(created.body.data);
    });

    it('reports an unknown reference', async () => {
      const response = await http
        .get('/transactions/trx_01hq3m8x0000zt7k9d2v4bqf1c')
        .expect(404);

      expect(response.body.code).toBe(ResponseCode.TRANSACTION_NOT_FOUND);
      expect(response.body.message).toBe(ResponseMessage.TRANSACTION_NOT_FOUND);
    });

    it('refuses a reference of the wrong family before querying', async () => {
      const response = await http.get(`/transactions/${user}`).expect(400);
      expect(response.body.data[0].field).toBe('reference');
    });
  });

  describe('the ledger', () => {
    it('is append-only, enforced by the database itself', async () => {
      const dataSource = app.get(DataSource);

      await expect(dataSource.query('UPDATE transactions SET amount = 1')).rejects.toThrow(
        /append-only/,
      );
      await expect(dataSource.query('DELETE FROM transactions')).rejects.toThrow(/append-only/);
    });
  });
});
