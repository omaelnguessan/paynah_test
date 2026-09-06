import { CircuitBreaker, CircuitOpenError, CircuitState } from './circuit-breaker';
import { backoffDelay, isRetryable } from './retry-policy';

describe('isRetryable', () => {
  it.each([
    ['a timeout', { timedOut: true }],
    ['a refused connection', { code: 'ECONNREFUSED' }],
    ['a reset connection', { code: 'ECONNRESET' }],
    ['a 500', { status: 500 }],
    ['a 503', { status: 503 }],
    ['a 429', { status: 429 }],
    ['no response at all', {}],
  ])('retries %s', (_label, failure) => {
    expect(isRetryable(failure)).toBe(true);
  });

  it.each([
    ['a business refusal', { status: 422 }],
    ['a not found', { status: 404 }],
    ['a validation failure', { status: 400 }],
    ['a rejected credential', { status: 401 }],
    ['a conflict', { status: 409 }],
  ])('does not retry %s', (_label, failure) => {
    // Retrying a decision wastes time and risks a second movement.
    expect(isRetryable(failure)).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and stays under the ceiling', () => {
    const options = { baseMs: 100, maxMs: 3000, random: () => 1 };

    expect(backoffDelay(1, options)).toBe(100);
    expect(backoffDelay(2, options)).toBe(200);
    expect(backoffDelay(3, options)).toBe(400);
    expect(backoffDelay(10, options)).toBe(3000);
  });

  it('jitters, so simultaneous failures do not come back together', () => {
    const delays = new Set(
      Array.from({ length: 50 }, () => backoffDelay(4, { baseMs: 100, maxMs: 3000 })),
    );
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('CircuitBreaker', () => {
  const options = { name: 'accounts', failureThreshold: 3, openMs: 1000, successThreshold: 1 };

  function breakerAt(clock: { now: number }) {
    return new CircuitBreaker(options, () => clock.now);
  }

  it('stays closed while calls succeed', async () => {
    const breaker = breakerAt({ now: 0 });
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.currentState).toBe(CircuitState.Closed);
  });

  it('opens after the threshold and then fails fast', async () => {
    const clock = { now: 0 };
    const breaker = breakerAt(clock);
    const failing = () => Promise.reject(new Error('down'));

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(breaker.execute(failing)).rejects.toThrow('down');
    }
    expect(breaker.currentState).toBe(CircuitState.Open);

    // No call is even attempted while the circuit is open.
    const work = jest.fn();
    await expect(breaker.execute(work)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(work).not.toHaveBeenCalled();
  });

  it('lets one probe through once the cooling period is over', async () => {
    const clock = { now: 0 };
    const breaker = breakerAt(clock);
    const failing = () => Promise.reject(new Error('down'));

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(breaker.execute(failing)).rejects.toThrow('down');
    }

    clock.now = 1001;
    await expect(breaker.execute(() => Promise.resolve('back'))).resolves.toBe('back');
    expect(breaker.currentState).toBe(CircuitState.Closed);
  });

  it('reopens immediately when the probe fails', async () => {
    const clock = { now: 0 };
    const breaker = breakerAt(clock);
    const failing = () => Promise.reject(new Error('down'));

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(breaker.execute(failing)).rejects.toThrow('down');
    }
    clock.now = 1001;
    await expect(breaker.execute(failing)).rejects.toThrow('down');

    expect(breaker.currentState).toBe(CircuitState.Open);
  });

  it('resets the count after a success, so scattered failures never open it', async () => {
    const breaker = breakerAt({ now: 0 });
    const failing = () => Promise.reject(new Error('down'));

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    await breaker.execute(() => Promise.resolve('ok'));
    await expect(breaker.execute(failing)).rejects.toThrow();

    expect(breaker.currentState).toBe(CircuitState.Closed);
  });

  it('counts a declined payment as a healthy answer', async () => {
    const breaker = breakerAt({ now: 0 });
    const failing = () => Promise.reject(new Error('down'));

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    // A refusal means the service is up and answering.
    breaker.recordHealthy();
    await expect(breaker.execute(failing)).rejects.toThrow();

    expect(breaker.currentState).toBe(CircuitState.Closed);
  });
});
