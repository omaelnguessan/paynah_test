import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AllExceptionsFilter,
  ResponseCode,
  ResponseInterceptor,
  ResponseMessage,
  createValidationPipe,
} from '@paynad/shared';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CommandBus } from '@nestjs/cqrs';
import { CompensatePaymentCommand } from '../src/application/commands/compensate-payment.command';
import { AccountsUnavailableError } from '../src/domain/errors/accounts-unavailable.error';
import { PaymentStatus } from '../src/domain/model/payment-status';
import { ACCOUNTS_PORT, AccountsPort } from '../src/domain/ports/accounts.port';
import { DomainErrorFilter } from '../src/presentation/filters/domain-error.filter';

/**
 * Drives the real saga against the real `accounts` service and the real
 * database. Everything interesting here — idempotency, compensation, the
 * outbox — is about what survives a boundary, so stubbing the boundary out
 * would be testing the stub.
 *
 * Needs the stack up: `make up && make migrate && make seed`.
 */
describe('payments (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let dataSource: DataSource;

  const accountsUrl = process.env.ACCOUNTS_SERVICE_URL ?? 'http://accounts:3001';
  const transactionsUrl = process.env.TRANSACTIONS_SERVICE_URL ?? 'http://transactions:3002';
  const credentials = {
    'x-api-key': process.env.INTERNAL_API_KEY ?? 'dev-internal-key-change-me',
    'x-api-secret': process.env.INTERNAL_API_SECRET ?? 'dev-internal-secret-change-me-0123456789',
  };

  let user: string;
  let source: string;
  let destination: string;

  const stamp = Date.now();
  let sequence = 0;
  const nextKey = (label: string): string => `e2e-${label}-${stamp}-${sequence++}`;

  /** The envelope every accounts endpoint answers with. */
  interface Envelope<T> {
    code: string;
    message: string;
    data: T;
  }

  async function callAccounts<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${accountsUrl}${path}`, init);
    const body = (await response.json()) as Envelope<T>;
    return body.data;
  }

  /** Creates a funded wallet through the real accounts API. */
  async function fundedWallet(balance: number): Promise<string> {
    const wallet = await callAccounts<{ reference: string }>('/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_reference: user, currency: 'XOF', initial_balance: balance }),
    });
    return wallet.reference;
  }

  async function balanceOf(wallet: string): Promise<number> {
    const balance = await callAccounts<{ balance: number }>(`/accounts/${wallet}/balance`);
    return balance.balance;
  }

  /** One ledger movement, as the transactions service stores it. */
  interface LedgerLine {
    reference: string;
    payment_reference: string;
    type: 'DEBIT' | 'CREDIT' | 'REFUND';
    wallet_reference: string;
    amount: number;
  }

  /** Every movement the ledger holds for one payment, across both wallets. */
  async function ledgerOf(wallet: string, paymentReference?: string): Promise<LedgerLine[]> {
    const response = await fetch(
      `${transactionsUrl}/transactions?wallet_reference=${wallet}&per_page=100`,
    );
    const body = (await response.json()) as Envelope<{ items: LedgerLine[] }>;
    const items = body.data?.items ?? [];
    return paymentReference
      ? items.filter((line) => line.payment_reference === paymentReference)
      : items;
  }

  /**
   * The ledger is fed through the outbox and the broker, so it is eventually
   * consistent by design. Polling is the honest way to assert on it — a fixed
   * sleep would either be flaky or slow, and usually both.
   */
  async function eventually<T>(
    read: () => Promise<T>,
    holds: (value: T) => boolean,
    timeoutMs = 15_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last = await read();
    while (!holds(last) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      last = await read();
    }
    return last;
  }

  async function setWalletStatus(wallet: string, status: 'Active' | 'Frozen'): Promise<void> {
    // The API has no freeze endpoint; the fixture is set where it lives.
    const accounts = new DataSource({
      type: 'postgres',
      host: process.env.ACCOUNTS_DB_HOST ?? 'pg-accounts',
      port: Number(process.env.ACCOUNTS_DB_PORT ?? 5432),
      username: 'accounts_user',
      password: 'accounts_pwd',
      database: 'accounts',
    });
    await accounts.initialize();
    await accounts.query('UPDATE wallets SET status = $1 WHERE reference = $2', [status, wallet]);
    await accounts.destroy();
  }

  const initiate = (body: Record<string, unknown>) =>
    http.post('/payments').set('x-correlation-id', `e2e-${stamp}`).send(body);

  const payment = (overrides: Record<string, unknown> = {}) => ({
    transaction_id: nextKey('pay'),
    source_wallet_reference: source,
    destination_wallet_reference: destination,
    amount: 5_000,
    currency: 'XOF',
    description: 'Paiement facture avril',
    lang: 'fr',
    metadata: { user_reference: user },
    ...overrides,
  });

  beforeAll(async () => {
    const created = await callAccounts<{ reference: string }>('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_firstname: 'Saga',
        customer_lastname: 'Test',
        customer_email: `saga-${stamp}@example.com`,
        customer_phone_number: '+2250700000009',
      }),
    });
    user = created.reference;
    source = await fundedWallet(1_000_000);
    destination = await fundedWallet(0);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter(), new DomainErrorFilter());
    await app.init();
    await app.listen(0);
    http = request(app.getHttpServer());
    dataSource = app.get(DataSource);

    expect(credentials['x-api-key']).toBeDefined();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('a payment that settles', () => {
    it('debits, credits and approves, moving the money exactly once', async () => {
      const before = { source: await balanceOf(source), destination: await balanceOf(destination) };
      const body = payment({ amount: 15_000 });

      const response = await initiate(body).expect(201);
      const data = response.body.data;

      expect(data.status).toBe(PaymentStatus.Approved);
      expect(data.reference).toMatch(/^pay_[0-9a-hjkmnp-tv-z]{26}$/);
      expect(data.debit_transaction_reference).toMatch(/^trx_/);
      expect(data.credit_transaction_reference).toMatch(/^trx_/);
      expect(data.failure_reason).toBeNull();
      expect(data.completed_at).not.toBeNull();

      expect(await balanceOf(source)).toBe(before.source - 15_000);
      expect(await balanceOf(destination)).toBe(before.destination + 15_000);
    });

    it('queues both ledger movements in the outbox, in the same commit', async () => {
      const body = payment({ amount: 500 });
      const response = await initiate(body).expect(201);

      const rows = await dataSource.query(
        `SELECT event_type, payload FROM outbox WHERE aggregate_reference = $1 ORDER BY created_at`,
        [response.body.data.reference],
      );

      const ledgerRows = rows.filter(
        (row: { event_type: string }) => row.event_type === 'payment.transaction.recorded',
      );
      expect(ledgerRows).toHaveLength(2);
      expect(ledgerRows.map((row: { payload: { type: string } }) => row.payload.type)).toEqual([
        'DEBIT',
        'CREDIT',
      ]);
      // The correlation id rides along, so the ledger's logs join the same grep.
      expect(ledgerRows[0].payload.correlation_id).toBe(`e2e-${stamp}`);
    });

    it('lands as exactly two movements in the ledger, one per wallet', async () => {
      const created = await initiate(payment({ amount: 3_000 })).expect(201);
      const reference = created.body.data.reference;

      const lines = await eventually(
        () => ledgerOf(source, reference),
        (rows) => rows.length >= 1,
      );
      const credited = await eventually(
        () => ledgerOf(destination, reference),
        (rows) => rows.length >= 1,
      );

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ type: 'DEBIT', wallet_reference: source, amount: 3_000 });
      expect(credited).toHaveLength(1);
      expect(credited[0]).toMatchObject({ type: 'CREDIT', wallet_reference: destination });
    }, 30_000);

    it('is readable afterwards through its reference', async () => {
      const created = await initiate(payment()).expect(201);
      const fetched = await http.get(`/payments/${created.body.data.reference}`).expect(200);

      expect(fetched.body.data).toEqual(created.body.data);
    });
  });

  describe('idempotency', () => {
    it('returns the very same payment when the key is replayed', async () => {
      const body = payment();
      const first = await initiate(body).expect(201);
      const before = await balanceOf(source);

      const replay = await initiate(body).expect(201);

      expect(replay.body.data).toEqual(first.body.data);
      expect(replay.body.data.reference).toBe(first.body.data.reference);
      // The replay moved no money: the use case never ran a second time.
      expect(await balanceOf(source)).toBe(before);

      const debits = await eventually(
        () => ledgerOf(source, first.body.data.reference),
        (rows) => rows.length >= 1,
      );
      expect(debits).toHaveLength(1);
    }, 30_000);

    it('refuses the same key with a different payload', async () => {
      const body = payment();
      await initiate(body).expect(201);

      const response = await initiate({ ...body, amount: 9_000 }).expect(409);

      expect(response.body.code).toBe(ResponseCode.IDEMPOTENCY_CONFLICT);
      expect(response.body.message).toBe(ResponseMessage.IDEMPOTENCY_CONFLICT);
    });

    it('creates exactly one payment under a concurrent replay', async () => {
      const body = payment({ amount: 100 });
      const before = await balanceOf(source);

      const attempts = await Promise.all(Array.from({ length: 8 }, () => initiate(body)));
      const references = new Set(
        attempts.filter((a) => a.status === 201).map((a) => a.body.data.reference),
      );

      expect(references.size).toBe(1);
      // Whoever lost the race got a 409 rather than a second payment.
      expect(attempts.every((a) => [201, 409].includes(a.status))).toBe(true);
      expect(await balanceOf(source)).toBe(before - 100);
    });
  });

  describe('a payment that is refused', () => {
    it('is declined without moving anything when the balance is short', async () => {
      const poor = await fundedWallet(500);
      const before = await balanceOf(poor);

      const response = await initiate(
        payment({ source_wallet_reference: poor, amount: 1_000_000 }),
      ).expect(201);

      expect(response.body.data.status).toBe(PaymentStatus.Declined);
      expect(response.body.data.failure_reason).toBe('INSUFFICIENT_BALANCE');
      expect(response.body.data.debit_transaction_reference).toBeNull();
      expect(await balanceOf(poor)).toBe(before);

      // Nothing moved, so nothing is journalised: a refused payment must leave
      // no trace in the ledger at all, not even a declined row.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(await ledgerOf(poor, response.body.data.reference)).toEqual([]);
    }, 30_000);

    it('refuses the movement at the accounts boundary too', async () => {
      const poor = await fundedWallet(500);

      const response = await fetch(`${accountsUrl}/accounts/${poor}/debit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...credentials },
        body: JSON.stringify({
          transaction_id: nextKey('direct-debit'),
          amount: 1_000_000,
          currency: 'XOF',
          description: 'Direct debit',
        }),
      });
      const body = (await response.json()) as Envelope<unknown>;

      // No resource is created there, so the refusal is an error envelope.
      expect(response.status).toBe(422);
      expect(body.code).toBe(ResponseCode.INSUFFICIENT_BALANCE);
      expect(body.message).toBe(ResponseMessage.INSUFFICIENT_BALANCE);
      expect(await balanceOf(poor)).toBe(500);
    });

    it('refuses a payment to the wallet it came from', async () => {
      const response = await initiate(
        payment({ destination_wallet_reference: source }),
      ).expect(422);

      expect(response.body.code).toBe(ResponseCode.VALIDATION_FAILED);
    });

    it('lists every faulty field of a malformed request', async () => {
      const response = await initiate(
        payment({ amount: 7, lang: 'de', description: 'bad # text' }),
      ).expect(400);

      expect(response.body.data.map((entry: { field: string }) => entry.field).sort()).toEqual([
        'amount',
        'description',
        'lang',
      ]);
    });
  });

  describe('compensation', () => {
    it('gives the money back when the credit fails after the debit', async () => {
      const frozen = await fundedWallet(0);
      await setWalletStatus(frozen, 'Frozen');
      const before = await balanceOf(source);

      const response = await initiate(
        payment({ destination_wallet_reference: frozen, amount: 2_500 }),
      ).expect(201);

      expect(response.body.data.status).toBe(PaymentStatus.Compensated);
      expect(response.body.data.debit_transaction_reference).toMatch(/^trx_/);
      // Debited then refunded: the payment leaves no net movement.
      expect(await balanceOf(source)).toBe(before);
    }, 30_000);
  });

  describe('an unavailable downstream', () => {
    /**
     * The downstream-failure scenario: `accounts.credit` times out
     * *after* the debit went through. Only the credit is stubbed — the debit
     * and the refund go to the real service, because what is being tested is
     * that the money actually comes back.
     */
    let stalled: INestApplication;
    let stalledHttp: request.Agent;

    beforeAll(async () => {
      const real = app.get<AccountsPort>(ACCOUNTS_PORT);
      const timesOutOnCredit: AccountsPort = {
        debit: (wallet, money, key, details) => real.debit(wallet, money, key, details),
        findMovement: (wallet, key) => real.findMovement(wallet, key),
        credit: async (wallet, money, key, details) => {
          // The refund is a credit too, and it must go through for real.
          if (key.endsWith(':refund')) {
            return real.credit(wallet, money, key, details);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new AccountsUnavailableError('credit', 'TimeoutError: Timeout has occurred');
        },
      };

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ACCOUNTS_PORT)
        .useValue(timesOutOnCredit)
        .compile();
      stalled = moduleRef.createNestApplication();
      stalled.useGlobalPipes(createValidationPipe());
      stalled.useGlobalInterceptors(new ResponseInterceptor());
      stalled.useGlobalFilters(new AllExceptionsFilter(), new DomainErrorFilter());
      await stalled.init();
      await stalled.listen(0);
      stalledHttp = request(stalled.getHttpServer());
    }, 60_000);

    afterAll(async () => {
      await stalled?.close();
    });

    it('restores the source, compensates the payment and journalises the refund', async () => {
      const before = { source: await balanceOf(source), destination: await balanceOf(destination) };

      const response = await stalledHttp
        .post('/payments')
        .set('x-correlation-id', `e2e-${stamp}`)
        .send(payment({ amount: 7_500 }))
        .expect(201);
      const data = response.body.data;

      expect(data.status).toBe(PaymentStatus.Compensated);
      expect(data.failure_reason).toBe('CREDIT_FAILED');
      expect(data.debit_transaction_reference).toMatch(/^trx_/);
      expect(data.credit_transaction_reference).toBeNull();

      // The debit happened and was given back; the destination never saw a thing.
      expect(await balanceOf(source)).toBe(before.source);
      expect(await balanceOf(destination)).toBe(before.destination);

      const lines = await eventually(
        () => ledgerOf(source, data.reference),
        (rows) => rows.some((line) => line.type === 'REFUND'),
      );
      // The refund is a movement of its own, offsetting the debit rather than
      // amending it — the ledger is append-only.
      expect(lines.map((line) => line.type).sort()).toEqual(['REFUND']);
      expect(lines[0].reference).toMatch(/^trx_/);
      expect(await ledgerOf(destination, data.reference)).toEqual([]);
    }, 60_000);
  });

  describe('a debit whose outcome is unknown', () => {
    /**
     * The two states an interrupted debit can leave behind look identical from
     * the payment's side — `Processing`, no debit reference — and they need
     * opposite repairs. These two tests are the reason the reconciler asks
     * `accounts` instead of assuming.
     */
    let unreliable: INestApplication;
    let unreliableHttp: request.Agent;
    let commands: CommandBus;
    const behaviour = { landsBeforeFailing: true };

    beforeAll(async () => {
      const real = app.get<AccountsPort>(ACCOUNTS_PORT);
      const losesTheAnswer: AccountsPort = {
        credit: (wallet, money, key, details) => real.credit(wallet, money, key, details),
        findMovement: (wallet, key) => real.findMovement(wallet, key),
        debit: async (wallet, money, key, details) => {
          // Either the movement is applied and the answer is lost on the way
          // back, or the call never reaches `accounts` at all.
          if (behaviour.landsBeforeFailing) {
            await real.debit(wallet, money, key, details);
          }
          throw new AccountsUnavailableError('debit', 'TimeoutError: Timeout has occurred');
        },
      };

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ACCOUNTS_PORT)
        .useValue(losesTheAnswer)
        .compile();
      unreliable = moduleRef.createNestApplication();
      unreliable.useGlobalPipes(createValidationPipe());
      unreliable.useGlobalInterceptors(new ResponseInterceptor());
      unreliable.useGlobalFilters(new AllExceptionsFilter(), new DomainErrorFilter());
      await unreliable.init();
      await unreliable.listen(0);
      unreliableHttp = request(unreliable.getHttpServer());
      commands = unreliable.get(CommandBus);
    }, 60_000);

    afterAll(async () => {
      await unreliable?.close();
    });

    const initiateOnUnreliable = (body: Record<string, unknown>) =>
      unreliableHttp.post('/payments').set('x-correlation-id', `e2e-${stamp}`).send(body);

    /** What the reconciliation job does, without waiting five minutes for it. */
    const reconcile = (reference: string) =>
      commands.execute(new CompensatePaymentCommand(reference));

    it('leaves the payment in flight rather than declaring a decline it cannot know', async () => {
      behaviour.landsBeforeFailing = true;
      const wallet = await fundedWallet(50_000);
      const body = payment({ source_wallet_reference: wallet, amount: 20_000 });

      const response = await initiateOnUnreliable(body).expect(201);

      // Declining here would close the payment over money that has left.
      expect(response.body.data.status).toBe(PaymentStatus.Processing);
      expect(response.body.data.failure_reason).toBeNull();
      expect(await balanceOf(wallet)).toBe(30_000);

      // The reconciler asks `accounts`, finds the movement, and unwinds it.
      await expect(reconcile(response.body.data.reference)).resolves.toMatch(/^trx_/);

      const settled = await http.get(`/payments/${response.body.data.reference}`).expect(200);
      expect(settled.body.data.status).toBe(PaymentStatus.Compensated);
      expect(settled.body.data.debit_transaction_reference).toMatch(/^trx_/);
      expect(await balanceOf(wallet)).toBe(50_000);
    }, 60_000);

    it('never refunds a debit that never happened', async () => {
      behaviour.landsBeforeFailing = false;
      const wallet = await fundedWallet(50_000);
      const body = payment({ source_wallet_reference: wallet, amount: 20_000 });

      const response = await initiateOnUnreliable(body).expect(201);
      const reference = response.body.data.reference;

      expect(response.body.data.status).toBe(PaymentStatus.Processing);
      expect(await balanceOf(wallet)).toBe(50_000);

      // Nothing was found under the debit key, so there is nothing to give
      // back: refunding here would credit money the wallet never lost.
      await expect(reconcile(reference)).resolves.toBeNull();

      const settled = await http.get(`/payments/${reference}`).expect(200);
      expect(settled.body.data.status).toBe(PaymentStatus.Declined);
      expect(settled.body.data.debit_transaction_reference).toBeNull();
      expect(await balanceOf(wallet)).toBe(50_000);
      expect(await ledgerOf(wallet, reference)).toEqual([]);
    }, 60_000);
  });

  describe('ten payments racing for a balance that covers six', () => {
    /**
     * The conditional UPDATE in `accounts` is the only arbiter of the balance.
     * Ten concurrent payments against funds for six must therefore settle
     * exactly six times — no negative balance, no lost update, no double debit.
     */
    it('approves exactly six and declines four, leaving the wallet at zero', async () => {
      const amount = 10_000;
      const racer = await fundedWallet(amount * 6);

      const attempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          initiate(
            payment({
              transaction_id: nextKey('race'),
              source_wallet_reference: racer,
              amount,
            }),
          ),
        ),
      );

      expect(attempts.every((attempt) => attempt.status === 201)).toBe(true);
      const outcomes = attempts.map((attempt) => attempt.body.data.status);
      expect(outcomes.filter((status) => status === PaymentStatus.Approved)).toHaveLength(6);
      expect(outcomes.filter((status) => status === PaymentStatus.Declined)).toHaveLength(4);

      for (const attempt of attempts) {
        if (attempt.body.data.status === PaymentStatus.Declined) {
          expect(attempt.body.data.failure_reason).toBe('INSUFFICIENT_BALANCE');
          expect(attempt.body.data.debit_transaction_reference).toBeNull();
        }
      }

      // Every approved payment moved exactly its amount, and not one of the
      // four refusals took the wallet below zero on its way through.
      const remaining = await balanceOf(racer);
      expect(remaining).toBe(0);

      const debits = await eventually(
        () => ledgerOf(racer),
        (rows) => rows.filter((line) => line.type === 'DEBIT').length >= 6,
      );
      expect(debits.filter((line) => line.type === 'DEBIT')).toHaveLength(6);
      // Six distinct payments, six distinct movements: nothing was applied twice.
      expect(new Set(debits.map((line) => line.payment_reference)).size).toBe(
        debits.filter((line) => line.type === 'DEBIT').length,
      );
    }, 120_000);
  });

  describe('the admin listing', () => {
    it('pages through payments newest first', async () => {
      const response = await http.get('/payments').query({ per_page: 2 }).expect(200);

      expect(response.body.data).toMatchObject({ page: 1, per_page: 2 });
      expect(response.body.data.items.length).toBeLessThanOrEqual(2);
      expect(response.body.data.total).toBeGreaterThan(0);
    });

    it('filters by status', async () => {
      const response = await http
        .get('/payments')
        .query({ status: PaymentStatus.Approved, per_page: 5 })
        .expect(200);

      for (const item of response.body.data.items) {
        expect(item.status).toBe(PaymentStatus.Approved);
      }
    });

    it('rejects a status it does not know', async () => {
      const response = await http.get('/payments').query({ status: 'Sideways' }).expect(400);
      expect(response.body.data[0].field).toBe('status');
    });
  });

  describe('reading an unknown payment', () => {
    it('reports it as not found', async () => {
      const response = await http
        .get('/payments/pay_01hq3m8x0000zt7k9d2v4bqf1c')
        .expect(404);

      expect(response.body.message).toBe(ResponseMessage.TRANSACTION_NOT_FOUND);
    });

    it('refuses a reference of the wrong family before querying', async () => {
      const response = await http.get(`/payments/${source}`).expect(400);
      expect(response.body.data[0].field).toBe('reference');
    });
  });
});
