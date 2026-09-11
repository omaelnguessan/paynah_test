import { PostgresPaymentExecution } from './postgres-payment-execution';
import { TransactionContext } from './transaction-context';
import { DataSource } from 'typeorm';
import { ConcurrentPaymentError } from '../../domain/errors/concurrent-payment.error';

function fixture() {
  let owner = false;
  const runners: Array<{ release: jest.Mock; query: jest.Mock }> = [];
  const dataSource = {
    createQueryRunner: () => {
      const runner = {
        connect: jest.fn(),
        release: jest.fn(),
        query: jest.fn(async (sql: string) => {
          if (sql.includes('pg_try_advisory_lock')) {
            if (owner) return [{ locked: false }];
            owner = true;
            return [{ locked: true }];
          }
          owner = false;
          return [];
        }),
      };
      runners.push(runner);
      return runner;
    },
  } as unknown as DataSource;
  const transaction = new TransactionContext(dataSource);
  return {
    first: new PostgresPaymentExecution(dataSource, transaction),
    second: new PostgresPaymentExecution(dataSource, transaction),
    runners,
  };
}

describe('PostgresPaymentExecution', () => {
  it('excludes a competing instance throughout the remote work, then releases the session', async () => {
    const { first, second, runners } = fixture();
    let finish!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const inFlight = first.run('pay_x', async () => {
      entered();
      await done;
    });
    await ready;
    const competingWork = jest.fn();
    await expect(second.run('pay_x', competingWork)).rejects.toBeInstanceOf(ConcurrentPaymentError);
    expect(competingWork).not.toHaveBeenCalled();
    finish();
    await inFlight;
    await expect(second.run('pay_x', async () => 'recovered')).resolves.toBe('recovered');
    expect(runners.every((runner) => runner.release.mock.calls.length === 1)).toBe(true);
  });

  it('allows nested saga commands and releases the lock after failure', async () => {
    const { first, second, runners } = fixture();
    await expect(
      first.run('pay_x', () =>
        first.run('pay_x', async () => {
          throw new Error('remote failure');
        }),
      ),
    ).rejects.toThrow('remote failure');
    expect(runners).toHaveLength(1);
    await expect(second.run('pay_x', async () => 1)).resolves.toBe(1);
  });
});
