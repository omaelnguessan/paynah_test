import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { CORRELATION_ID_HEADER } from '@paynad/shared';
import { AccountsUnavailableError } from '../../domain/errors/accounts-unavailable.error';
import { DomainError } from '../../domain/errors/domain.error';
import { InsufficientBalanceError } from '../../domain/errors/insufficient-balance.error';
import {
  CurrencyMismatchError,
  WalletFrozenError,
  WalletNotFoundError,
} from '../../domain/errors/wallet.errors';
import { Money } from '../../domain/model/money';
import { Reference } from '../../domain/model/reference';
import { AccountsPort, MovementDetails, MovementResult } from '../../domain/ports/accounts.port';
import { CorrelationContext } from './correlation.context';
import {
  AccountsEnvelope,
  BalanceOperationPayload,
  toMovementResult,
} from './mappers/movement.mapper';
import { CircuitBreaker, CircuitOpenError } from './resilience/circuit-breaker';
import { backoffDelay, isRetryable } from './resilience/retry-policy';

/** `accounts` answers with these applicative codes; they map onto domain errors. */
const DOMAIN_ERRORS: Readonly<Record<string, (wallet: string) => DomainError>> = {
  INSUFFICIENT_BALANCE: (wallet) => new InsufficientBalanceError(wallet),
  WALLET_NOT_FOUND: (wallet) => new WalletNotFoundError(wallet),
  WALLET_FROZEN: (wallet) => new WalletFrozenError(wallet),
  CURRENCY_MISMATCH: (wallet) => new CurrencyMismatchError(wallet),
};

/**
 * The one place in the service that knows `accounts` speaks HTTP.
 *
 * It owns the timeout, the retries and the circuit breaker, and it translates
 * every answer into the domain's vocabulary — so nothing above ever sees an
 * `AxiosError`, a status code or an external field name.
 */
@Injectable()
export class AccountsHttpClient implements AccountsPort {
  private readonly logger = new Logger(AccountsHttpClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly breaker: CircuitBreaker;
  private readonly credentials: { 'x-api-key': string; 'x-api-secret': string };

  constructor(
    private readonly http: HttpService,
    private readonly correlation: CorrelationContext,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('ACCOUNTS_SERVICE_URL');
    this.timeoutMs = Number(config.get('HTTP_TIMEOUT_MS') ?? 3000);
    this.maxAttempts = Number(config.get('HTTP_MAX_RETRIES') ?? 2) + 1;
    this.credentials = {
      'x-api-key': config.getOrThrow<string>('INTERNAL_API_KEY'),
      'x-api-secret': config.getOrThrow<string>('INTERNAL_API_SECRET'),
    };
    this.breaker = new CircuitBreaker({
      name: 'accounts',
      failureThreshold: Number(config.get('CIRCUIT_FAILURE_THRESHOLD') ?? 5),
      openMs: Number(config.get('CIRCUIT_OPEN_MS') ?? 10_000),
      successThreshold: 1,
    });
  }

  debit(
    wallet: Reference,
    money: Money,
    idempotencyKey: string,
    details: MovementDetails,
  ): Promise<MovementResult> {
    return this.movement('debit', wallet, money, idempotencyKey, details);
  }

  credit(
    wallet: Reference,
    money: Money,
    idempotencyKey: string,
    details: MovementDetails,
  ): Promise<MovementResult> {
    return this.movement('credit', wallet, money, idempotencyKey, details);
  }

  /**
   * The read that lets the saga stop guessing. A 404 is an answer — the key
   * moved nothing — so it comes back as `null` rather than as a failure. Only
   * a genuine inability to reach `accounts` is an error here, because "I do not
   * know" and "it did not happen" must never collapse into the same value.
   */
  async findMovement(wallet: Reference, idempotencyKey: string): Promise<MovementResult | null> {
    const url = `${this.baseUrl}/accounts/${wallet.value}/movements/${encodeURIComponent(idempotencyKey)}`;

    try {
      const payload = await this.breaker.execute(() => this.read(url));
      return payload ? toMovementResult(payload) : null;
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        throw new AccountsUnavailableError('find-movement', 'circuit open');
      }
      this.logger.error(
        {
          operation: 'find-movement',
          wallet_reference: wallet.value,
          correlation_id: this.correlation.current,
          cause: describe(error),
        },
        'could not establish whether the movement exists',
      );
      throw new AccountsUnavailableError('find-movement', describe(error));
    }
  }

  private async movement(
    operation: 'debit' | 'credit',
    wallet: Reference,
    money: Money,
    idempotencyKey: string,
    details: MovementDetails,
  ): Promise<MovementResult> {
    const url = `${this.baseUrl}/accounts/${wallet.value}/${operation}`;
    const body = {
      transaction_id: idempotencyKey,
      amount: money.amount,
      currency: money.currency,
      description: details.description,
      // The link back to the payment lives in this field, not in the free text:
      // a description may not contain an underscore, and a reference always does.
      payment_reference: details.paymentReference.value,
    };

    try {
      const payload = await this.breaker.execute(() => this.send(operation, url, body, wallet));
      return toMovementResult(payload);
    } catch (error) {
      if (error instanceof DomainError) {
        // A refusal is a healthy answer from a healthy service: it must not
        // count towards opening the circuit.
        this.breaker.recordHealthy();
        throw error;
      }
      if (error instanceof CircuitOpenError) {
        throw new AccountsUnavailableError(operation, 'circuit open');
      }
      this.logger.error(
        {
          operation,
          wallet_reference: wallet.value,
          correlation_id: this.correlation.current,
          cause: describe(error),
        },
        'the accounts call failed after every attempt',
      );
      throw new AccountsUnavailableError(operation, describe(error));
    }
  }

  /** Retries only what is worth retrying, with exponential backoff and jitter. */
  private async send(
    operation: string,
    url: string,
    body: Record<string, unknown>,
    wallet: Reference,
  ): Promise<BalanceOperationPayload> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await firstValueFrom(
          this.http
            .post<AccountsEnvelope<BalanceOperationPayload>>(url, body, {
              headers: {
                ...this.credentials,
                [CORRELATION_ID_HEADER]: this.correlation.current,
              },
              // Statuses are read, not thrown on: a 422 is an answer.
              validateStatus: () => true,
            })
            .pipe(timeout(this.timeoutMs)),
        );

        const domainError = this.asDomainError(response, wallet);
        if (domainError) {
          throw domainError;
        }
        if (response.status >= 400) {
          throw new UpstreamHttpError(response.status, response.data?.message ?? 'unknown');
        }
        if (!response.data?.data) {
          throw new UpstreamHttpError(response.status, 'empty payload');
        }
        return response.data.data;
      } catch (error) {
        if (error instanceof DomainError) {
          if (lastError !== undefined) {
            throw new AccountsUnavailableError(operation, 'refusal after an uncertain attempt');
          }
          throw error;
        }
        lastError = error;

        const shape = shapeOf(error);
        if (!isRetryable(shape) || attempt === this.maxAttempts) {
          break;
        }
        const delay = backoffDelay(attempt, { baseMs: 100, maxMs: this.timeoutMs });
        this.logger.warn(
          {
            operation,
            attempt,
            delay_ms: delay,
            correlation_id: this.correlation.current,
            cause: describe(error),
          },
          'retrying an accounts call',
        );
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /** The same retry policy as a movement, on a call that changes nothing. */
  private async read(url: string): Promise<BalanceOperationPayload | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await firstValueFrom(
          this.http
            .get<AccountsEnvelope<BalanceOperationPayload>>(url, {
              headers: {
                ...this.credentials,
                [CORRELATION_ID_HEADER]: this.correlation.current,
              },
              validateStatus: () => true,
            })
            .pipe(timeout(this.timeoutMs)),
        );

        // The key has never moved money here. That is a fact, not a failure.
        if (response.status === 404) {
          return null;
        }
        if (response.status >= 400) {
          throw new UpstreamHttpError(response.status, response.data?.message ?? 'unknown');
        }
        if (!response.data?.data) {
          throw new UpstreamHttpError(response.status, 'empty payload');
        }
        return response.data.data;
      } catch (error) {
        lastError = error;
        const shape = shapeOf(error);
        if (!isRetryable(shape) || attempt === this.maxAttempts) {
          break;
        }
        await sleep(backoffDelay(attempt, { baseMs: 100, maxMs: this.timeoutMs }));
      }
    }

    throw lastError;
  }

  /** A 4xx the domain has a word for; anything else stays a transport failure. */
  private asDomainError(
    response: AxiosResponse<AccountsEnvelope<BalanceOperationPayload>>,
    wallet: Reference,
  ): DomainError | null {
    if (response.status < 400 || response.status >= 500) {
      return null;
    }
    const build = DOMAIN_ERRORS[response.data?.message ?? ''];
    return build ? build(wallet.value) : null;
  }
}

class UpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`accounts answered ${status}: ${message}`);
    this.name = 'UpstreamHttpError';
  }
}

function shapeOf(error: unknown): { status?: number; code?: string; timedOut?: boolean } {
  if (error instanceof UpstreamHttpError) {
    return { status: error.status };
  }
  const axiosError = error as AxiosError & { name?: string };
  if (axiosError?.name === 'TimeoutError') {
    return { timedOut: true };
  }
  return { status: axiosError?.response?.status, code: axiosError?.code };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
