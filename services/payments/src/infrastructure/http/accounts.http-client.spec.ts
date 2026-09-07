import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import nock from 'nock';
import { AccountsUnavailableError } from '../../domain/errors/accounts-unavailable.error';
import { InsufficientBalanceError } from '../../domain/errors/insufficient-balance.error';
import {
  CurrencyMismatchError,
  WalletFrozenError,
  WalletNotFoundError,
} from '../../domain/errors/wallet.errors';
import { Currency, Money } from '../../domain/model/money';
import { Reference } from '../../domain/model/reference';
import { AccountsHttpClient } from './accounts.http-client';
import { CorrelationContext } from './correlation.context';

const BASE_URL = 'http://accounts.test:3001';
const WALLET = Reference.of('wlt', 'wlt_01hq3m8x0000zt7k9d2v4bqf1c');
const PAYMENT = Reference.of('pay', 'pay_01hq3m8x0000zt7k9d2v4bqf1c');
const MONEY = Money.of(5_000, Currency.XOF);
const DETAILS = { description: 'Paiement facture avril', paymentReference: PAYMENT };

const SETTINGS: Record<string, string> = {
  ACCOUNTS_SERVICE_URL: BASE_URL,
  HTTP_TIMEOUT_MS: '300',
  HTTP_MAX_RETRIES: '2',
  INTERNAL_API_KEY: 'internal-key-0123456789',
  INTERNAL_API_SECRET: 'internal-secret-0123456789-0123456789',
  CIRCUIT_FAILURE_THRESHOLD: '50',
};

function approved(reference = 'trx_01hq3m8x0000zt7k9d2v4bqf1c') {
  return {
    code: '200',
    message: 'SUCCESS',
    data: {
      transaction_id: PAYMENT.value,
      reference,
      amount: 5_000,
      currency: 'XOF',
      balance_before: 10_000,
      balance_after: 5_000,
      status: 'Approved',
      declined_reason: null,
    },
  };
}

function refused(message: string) {
  return { code: '4001', message, data: { status: 'Declined', declined_reason: message } };
}

describe('AccountsHttpClient', () => {
  let client: AccountsHttpClient;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  /** A client wired exactly as production wires it, with its own settings. */
  async function createClient(overrides: Record<string, string> = {}) {
    const settings = { ...SETTINGS, ...overrides };
    const moduleRef = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        AccountsHttpClient,
        CorrelationContext,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => settings[key],
            getOrThrow: (key: string) => settings[key],
          },
        },
      ],
    }).compile();
    // The HTTP layer is real; only the network is intercepted.
    expect(moduleRef.get(HttpService)).toBeDefined();
    return moduleRef.get(AccountsHttpClient);
  }

  beforeEach(async () => {
    nock.cleanAll();
    client = await createClient();
  });

  describe('a successful movement', () => {
    it('returns the movement reference in domain terms', async () => {
      nock(BASE_URL).post(`/accounts/${WALLET.value}/debit`).reply(200, approved());

      const result = await client.debit(WALLET, MONEY, PAYMENT.value, DETAILS);

      expect(result.transactionReference.value).toBe('trx_01hq3m8x0000zt7k9d2v4bqf1c');
      expect(result.balanceAfter).toBe(5_000);
    });

    it('sends the idempotency key, the credentials and the correlation id', async () => {
      let seen: Record<string, unknown> = {};
      let headers: Record<string, string> = {};

      nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/credit`, (body) => {
          seen = body as Record<string, unknown>;
          return true;
        })
        .reply(function reply() {
          headers = this.req.headers as unknown as Record<string, string>;
          return [200, approved()];
        });

      await client.credit(WALLET, MONEY, `${PAYMENT.value}:credit`, DETAILS);

      expect(seen).toMatchObject({
        transaction_id: `${PAYMENT.value}:credit`,
        amount: 5_000,
        currency: 'XOF',
        // The link to the payment travels in its own field, never in the text.
        payment_reference: PAYMENT.value,
      });
      expect(headers['x-api-key']).toBe(SETTINGS.INTERNAL_API_KEY);
      expect(headers['x-correlation-id']).toBeDefined();
    });
  });

  describe('translating refusals', () => {
    it.each([
      ['INSUFFICIENT_BALANCE', 422, InsufficientBalanceError],
      ['WALLET_NOT_FOUND', 404, WalletNotFoundError],
      ['WALLET_FROZEN', 422, WalletFrozenError],
      ['CURRENCY_MISMATCH', 422, CurrencyMismatchError],
    ])('turns %s into a domain error', async (message, status, expected) => {
      nock(BASE_URL).post(`/accounts/${WALLET.value}/debit`).reply(status, refused(message));

      const error = await client.debit(WALLET, MONEY, PAYMENT.value, DETAILS).catch((e) => e);

      expect(error).toBeInstanceOf(expected);
      // No status code, no external field name escapes the client.
      expect(JSON.stringify(error)).not.toContain('422');
    });

    it('does not retry a business refusal', async () => {
      const scope = nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .reply(422, refused('INSUFFICIENT_BALANCE'));

      await expect(client.debit(WALLET, MONEY, PAYMENT.value, DETAILS)).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );
      expect(scope.isDone()).toBe(true);
      expect(nock.pendingMocks()).toEqual([]);
    });
  });

  describe('retrying', () => {
    it('retries a 503 and succeeds on a later attempt', async () => {
      nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .reply(503, { code: '5001', message: 'UPSTREAM_UNAVAILABLE', data: null })
        .post(`/accounts/${WALLET.value}/debit`)
        .reply(200, approved());

      const result = await client.debit(WALLET, MONEY, PAYMENT.value, DETAILS);

      expect(result.transactionReference.value).toMatch(/^trx_/);
    });

    it('retries a refused connection', async () => {
      nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .replyWithError({ code: 'ECONNREFUSED', message: 'connection refused' })
        .post(`/accounts/${WALLET.value}/debit`)
        .reply(200, approved());

      await expect(client.debit(WALLET, MONEY, PAYMENT.value, DETAILS)).resolves.toBeDefined();
    });

    it('gives up as unavailable once the attempts are spent', async () => {
      nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .times(3)
        .reply(503, { code: '5001', message: 'UPSTREAM_UNAVAILABLE', data: null });

      await expect(client.debit(WALLET, MONEY, PAYMENT.value, DETAILS)).rejects.toBeInstanceOf(
        AccountsUnavailableError,
      );
      expect(nock.pendingMocks()).toEqual([]);
    });

    it('treats a timeout as retryable', async () => {
      nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .delay(600)
        .reply(200, approved())
        .post(`/accounts/${WALLET.value}/debit`)
        .reply(200, approved());

      await expect(client.debit(WALLET, MONEY, PAYMENT.value, DETAILS)).resolves.toBeDefined();
    });

    it('reports an unauthorised call as unavailable rather than retrying it', async () => {
      const scope = nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .reply(401, { code: '4000', message: 'VALIDATION_FAILED', data: null });

      await expect(client.debit(WALLET, MONEY, PAYMENT.value, DETAILS)).rejects.toBeInstanceOf(
        AccountsUnavailableError,
      );
      expect(scope.isDone()).toBe(true);
    });

    it('propagates an exhausted timeout as an unavailable upstream', async () => {
      // Every attempt hangs past HTTP_TIMEOUT_MS: the caller must be told the
      // service is unreachable, never left waiting on a socket.
      nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .times(3)
        .delay(600)
        .reply(200, approved());

      const error = await client.debit(WALLET, MONEY, PAYMENT.value, DETAILS).catch((e) => e);

      expect(error).toBeInstanceOf(AccountsUnavailableError);
      expect(error.details).toMatchObject({ operation: 'debit' });
      expect(String(error.details.cause)).toContain('Timeout');
      expect(nock.pendingMocks()).toEqual([]);
    });
  });

  describe('looking a movement up', () => {
    const path = `/accounts/${WALLET.value}/movements/${encodeURIComponent(PAYMENT.value)}`;

    it('returns the movement the key produced', async () => {
      nock(BASE_URL).get(path).reply(200, approved());

      const found = await client.findMovement(WALLET, PAYMENT.value);

      expect(found?.transactionReference.value).toBe('trx_01hq3m8x0000zt7k9d2v4bqf1c');
      expect(found?.balanceAfter).toBe(5_000);
    });

    it('reads a 404 as an answer, not as a failure', async () => {
      nock(BASE_URL)
        .get(path)
        .reply(404, { code: '4008', message: 'TRANSACTION_NOT_FOUND', data: null });

      // The key moved nothing. That is a fact the saga acts on, so it must not
      // arrive as an exception alongside "I could not reach the service".
      await expect(client.findMovement(WALLET, PAYMENT.value)).resolves.toBeNull();
    });

    it('escapes a key that carries the saga separators', async () => {
      const key = `${PAYMENT.value}:credit`;
      nock(BASE_URL)
        .get(`/accounts/${WALLET.value}/movements/${encodeURIComponent(key)}`)
        .reply(200, approved());

      await expect(client.findMovement(WALLET, key)).resolves.not.toBeNull();
      expect(nock.pendingMocks()).toEqual([]);
    });

    it('sends the internal credentials', async () => {
      let headers: Record<string, string> = {};
      nock(BASE_URL)
        .get(path)
        .reply(function reply() {
          headers = this.req.headers as unknown as Record<string, string>;
          return [200, approved()];
        });

      await client.findMovement(WALLET, PAYMENT.value);

      expect(headers['x-api-key']).toBe(SETTINGS.INTERNAL_API_KEY);
    });

    it('retries, then reports that it still does not know', async () => {
      nock(BASE_URL)
        .get(path)
        .times(3)
        .reply(503, { code: '5001', message: 'UPSTREAM_UNAVAILABLE', data: null });

      // "Unknown" must never be mistaken for "no movement": one leads to a
      // refund, the other to inventing money.
      await expect(client.findMovement(WALLET, PAYMENT.value)).rejects.toBeInstanceOf(
        AccountsUnavailableError,
      );
      expect(nock.pendingMocks()).toEqual([]);
    });
  });

  describe('the circuit breaker', () => {
    const unavailable = { code: '5001', message: 'UPSTREAM_UNAVAILABLE', data: null };

    it('opens after N consecutive failures and then stops calling accounts', async () => {
      const breaking = await createClient({
        CIRCUIT_FAILURE_THRESHOLD: '2',
        HTTP_MAX_RETRIES: '0',
      });
      nock(BASE_URL).post(`/accounts/${WALLET.value}/debit`).times(2).reply(503, unavailable);

      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          breaking.debit(WALLET, MONEY, PAYMENT.value, DETAILS),
        ).rejects.toBeInstanceOf(AccountsUnavailableError);
      }
      expect(nock.pendingMocks()).toEqual([]);

      // Nothing is intercepted from here on: with the circuit open the client
      // must fail fast, and nock refuses any call that would reach the network.
      const error = await breaking
        .debit(WALLET, MONEY, PAYMENT.value, DETAILS)
        .catch((e) => e);

      expect(error).toBeInstanceOf(AccountsUnavailableError);
      expect(error.details).toMatchObject({ cause: 'circuit open' });
    });

    it('stays closed through a burst of refusals, which are healthy answers', async () => {
      const breaking = await createClient({
        CIRCUIT_FAILURE_THRESHOLD: '2',
        HTTP_MAX_RETRIES: '0',
      });
      nock(BASE_URL)
        .post(`/accounts/${WALLET.value}/debit`)
        .times(3)
        .reply(422, refused('INSUFFICIENT_BALANCE'));

      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(
          breaking.debit(WALLET, MONEY, PAYMENT.value, DETAILS),
        ).rejects.toBeInstanceOf(InsufficientBalanceError);
      }

      // A poor customer must never take the service down for everyone else.
      nock(BASE_URL).post(`/accounts/${WALLET.value}/debit`).reply(200, approved());
      await expect(breaking.debit(WALLET, MONEY, PAYMENT.value, DETAILS)).resolves.toBeDefined();
    });
  });
});
