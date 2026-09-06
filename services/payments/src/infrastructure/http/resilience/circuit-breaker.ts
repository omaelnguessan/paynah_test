import { Logger } from '@nestjs/common';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before a single probe is allowed through. */
  openMs: number;
  /** Successful probes needed to close it again. */
  successThreshold: number;
  name: string;
}

export enum CircuitState {
  Closed = 'Closed',
  Open = 'Open',
  HalfOpen = 'HalfOpen',
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`the circuit to ${name} is open`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * A small circuit breaker, deliberately hand-rolled: the behaviour is a dozen
 * lines and worth reading, and it keeps the dependency list honest.
 *
 * Once `accounts` has failed repeatedly, hammering it makes the outage worse and
 * makes every caller wait for a timeout that is already known to be coming.
 * Opening the circuit turns that wait into an immediate, explicit failure.
 */
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private state = CircuitState.Closed;
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly now: () => number = Date.now,
  ) {}

  get currentState(): CircuitState {
    return this.state;
  }

  async execute<T>(work: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.Open) {
      if (this.now() - this.openedAt < this.options.openMs) {
        throw new CircuitOpenError(this.options.name);
      }
      // The cooling period is over: let one request through and see.
      this.state = CircuitState.HalfOpen;
      this.successes = 0;
    }

    try {
      const result = await work();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Only failures that say something about the dependency's health count.
   * A declined payment is a healthy answer and must never open the circuit.
   */
  private onFailure(): void {
    this.failures += 1;
    this.successes = 0;
    if (this.state === CircuitState.HalfOpen || this.failures >= this.options.failureThreshold) {
      if (this.state !== CircuitState.Open) {
        this.logger.error(
          { circuit: this.options.name, failures: this.failures },
          'circuit opened',
        );
      }
      this.state = CircuitState.Open;
      this.openedAt = this.now();
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === CircuitState.HalfOpen) {
      this.successes += 1;
      if (this.successes >= this.options.successThreshold) {
        this.logger.log({ circuit: this.options.name }, 'circuit closed');
        this.state = CircuitState.Closed;
      }
      return;
    }
    this.state = CircuitState.Closed;
  }

  /** Records an outcome that is healthy for the dependency, whatever it means for us. */
  recordHealthy(): void {
    this.onSuccess();
  }
}
