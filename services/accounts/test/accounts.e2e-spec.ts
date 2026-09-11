import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AllExceptionsFilter,
  Currency,
  DeclinedReason,
  ResponseCode,
  ResponseInterceptor,
  ResponseMessage,
  TransactionStatus,
  createValidationPipe,
} from '@paynad/shared';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/** Integration tests against PostgreSQL. Requires `make up && make migrate`. */
describe('accounts (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;

  const credentials = {
    'x-api-key': process.env.INTERNAL_API_KEY ?? 'dev-internal-key-change-me',
    'x-api-secret':
      process.env.INTERNAL_API_SECRET ?? 'dev-internal-secret-change-me-0123456789',
  };

  let userReference: string;
  let walletReference: string;

  const uniqueEmail = (): string => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    // Listen for real rather than relying on supertest's per-request ephemeral
    // server: the concurrency tests fire twenty requests at once.
    await app.listen(0);
    http = request(app.getHttpServer());

    const user = await http
      .post('/users')
      .send({
        customer_firstname: 'Awa',
        customer_lastname: 'Traoré',
        customer_email: uniqueEmail(),
        customer_phone_number: '+2250700000000',
        customer_address: null,
        customer_city: 'Abidjan',
        customer_country: 'CI',
        customer_zip_code: null,
      })
      .expect(201);
    userReference = user.body.data.reference;

    const wallet = await http
      .post('/accounts')
      .send({
        user_reference: userReference,
        currency: Currency.XOF,
        initial_balance: 10_000,
        label: null,
      })
      .expect(201);
    walletReference = wallet.body.data.reference;
  });

  afterAll(async () => {
    await app?.close();
  });

  const debit = (body: Record<string, unknown>) =>
    http.post(`/accounts/${walletReference}/debit`).set(credentials).send(body);

  describe('users', () => {
    it('creates a user with a usr_ reference and no internal id', async () => {
      expect(userReference).toMatch(/^usr_[0-9a-hjkmnp-tv-z]{26}$/);
      const response = await http.get(`/users/${userReference}`).expect(200);
      expect(response.body.data).not.toHaveProperty('id');
      expect(response.body.data.customer_country).toBe('CI');
    });

    it('rejects a duplicate email at the database level', async () => {
      const email = uniqueEmail();
      const payload = {
        customer_firstname: 'Kofi',
        customer_lastname: 'Mensah',
        customer_email: email,
        customer_phone_number: '+2250700000009',
      };
      await http.post('/users').send(payload).expect(201);
      const response = await http.post('/users').send(payload).expect(400);

      expect(response.body.code).toBe(ResponseCode.VALIDATION_FAILED);
      expect(response.body.data[0].field).toBe('customer_email');
    });

    it('reports an unknown user', async () => {
      const response = await http.get('/users/usr_01hq3m8x0000zt7k9d2v4bqf1c').expect(404);
      expect(response.body.message).toBe(ResponseMessage.USER_NOT_FOUND);
    });

    it('refuses a malformed reference before it reaches a query', async () => {
      const response = await http.get('/users/not-a-reference').expect(400);
      expect(response.body.data[0].field).toBe('reference');
    });
  });

  describe('wallets', () => {
    it('exposes balance and available_balance', async () => {
      const response = await http.get(`/accounts/${walletReference}/balance`).expect(200);
      expect(response.body.data).toEqual({
        reference: walletReference,
        user_reference: userReference,
        currency: Currency.XOF,
        balance: 10_000,
        available_balance: 10_000,
        status: 'Active',
      });
    });

    it('refuses a wallet for an unknown user', async () => {
      const response = await http
        .post('/accounts')
        .send({ user_reference: 'usr_01hq3m8x0000zt7k9d2v4bqf1c', currency: Currency.XOF })
        .expect(404);
      expect(response.body.message).toBe(ResponseMessage.USER_NOT_FOUND);
    });
  });

  describe('internal endpoints', () => {
    it('rejects a call with no credentials', async () => {
      await http
        .post(`/accounts/${walletReference}/debit`)
        .send({
          transaction_id: 'unauthorized-0001',
          amount: 5,
          currency: Currency.XOF,
          description: 'Should not pass',
        })
        .expect(401);
    });

    it('rejects a call with a wrong secret', async () => {
      await http
        .post(`/accounts/${walletReference}/debit`)
        .set({ ...credentials, 'x-api-secret': 'wrong' })
        .send({
          transaction_id: 'unauthorized-0002',
          amount: 5,
          currency: Currency.XOF,
          description: 'Should not pass',
        })
        .expect(401);
    });
  });

  describe('movements', () => {
    it('debits, then returns the very same movement on a replay', async () => {
      const transaction_id = `e2e-debit-${Date.now()}`;
      const body = {
        transaction_id,
        amount: 2_500,
        currency: Currency.XOF,
        description: 'Paiement facture avril',
        payment_reference: null,
      };

      const first = await debit(body).expect(200);
      expect(first.body.data).toMatchObject({
        status: TransactionStatus.APPROVED,
        balance_before: 10_000,
        balance_after: 7_500,
        declined_reason: null,
      });
      expect(first.body.data.reference).toMatch(/^trx_/);

      const replay = await debit(body).expect(200);
      expect(replay.body).toEqual(first.body);

      const balance = await http.get(`/accounts/${walletReference}/balance`).expect(200);
      expect(balance.body.data.balance).toBe(7_500);
    });

    it('refuses the same key replayed with a different body', async () => {
      const transaction_id = `e2e-conflict-${Date.now()}`;
      const body = {
        transaction_id,
        amount: 500,
        currency: Currency.XOF,
        description: 'First shape',
      };
      await debit(body).expect(200);

      const response = await debit({ ...body, amount: 1_000 }).expect(409);
      expect(response.body.code).toBe(ResponseCode.IDEMPOTENCY_CONFLICT);
      expect(response.body.message).toBe(ResponseMessage.IDEMPOTENCY_CONFLICT);
    });

    it('declines an oversized debit with 422 and writes nothing', async () => {
      const before = await http.get(`/accounts/${walletReference}/balance`).expect(200);

      const response = await debit({
        transaction_id: `e2e-insufficient-${Date.now()}`,
        amount: 1_000_000_000,
        currency: Currency.XOF,
        description: 'Beyond the balance',
      }).expect(422);

      expect(response.body.code).toBe(ResponseCode.INSUFFICIENT_BALANCE);
      expect(response.body.message).toBe(ResponseMessage.INSUFFICIENT_BALANCE);
      expect(response.body.data).toMatchObject({
        status: TransactionStatus.DECLINED,
        declined_reason: DeclinedReason.INSUFFICIENT_BALANCE,
        reference: null,
      });

      const after = await http.get(`/accounts/${walletReference}/balance`).expect(200);
      expect(after.body.data.balance).toBe(before.body.data.balance);
    });

    it('lists every faulty field of a malformed movement', async () => {
      const response = await http
        .post(`/accounts/${walletReference}/credit`)
        .set(credentials)
        .send({
          transaction_id: 'short',
          amount: 7,
          currency: 'XOF',
          description: 'bad # description',
        })
        .expect(400);

      expect(response.body.data.map((entry: { field: string }) => entry.field).sort()).toEqual([
        'amount',
        'description',
        'transaction_id',
      ]);
    });

    it('never lets concurrent debits overdraw the wallet', async () => {
      const funded = await http
        .post('/accounts')
        .send({ user_reference: userReference, currency: Currency.XOF, initial_balance: 1_000 })
        .expect(201);
      const reference = funded.body.data.reference;
      const stamp = Date.now();

      const attempts = await Promise.all(
        Array.from({ length: 20 }, (_unused, index) =>
          http
            .post(`/accounts/${reference}/debit`)
            .set(credentials)
            .send({
              transaction_id: `e2e-race-${stamp}-${index}`,
              amount: 100,
              currency: Currency.XOF,
              description: 'Concurrent debit',
            }),
        ),
      );

      const approved = attempts.filter((attempt) => attempt.status === 200);
      const declined = attempts.filter((attempt) => attempt.status === 422);

      expect(approved).toHaveLength(10);
      expect(declined).toHaveLength(10);

      const balance = await http.get(`/accounts/${reference}/balance`).expect(200);
      expect(balance.body.data.balance).toBe(0);
    });

    it('applies a key exactly once even when replayed concurrently', async () => {
      const funded = await http
        .post('/accounts')
        .send({ user_reference: userReference, currency: Currency.XOF, initial_balance: 1_000 })
        .expect(201);
      const reference = funded.body.data.reference;
      const transaction_id = `e2e-replay-${Date.now()}`;

      const attempts = await Promise.all(
        Array.from({ length: 20 }, () =>
          http
            .post(`/accounts/${reference}/debit`)
            .set(credentials)
            .send({
              transaction_id,
              amount: 100,
              currency: Currency.XOF,
              description: 'Concurrent replay',
            })
            .expect(200),
        ),
      );

      const references = new Set(attempts.map((attempt) => attempt.body.data.reference));
      expect(references.size).toBe(1);

      const balance = await http.get(`/accounts/${reference}/balance`).expect(200);
      expect(balance.body.data.balance).toBe(900);
    });
  });

  describe('the ledger', () => {
    it('is append-only, enforced by the database itself', async () => {
      const dataSource = app.get(DataSource);
      await expect(dataSource.query('UPDATE ledger_entries SET amount = 1')).rejects.toThrow(
        /append-only/,
      );
      await expect(dataSource.query('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/);
    });
  });
});
