/**
 * Runs a unit of work atomically.
 *
 * The domain needs to say "these writes commit together" without knowing that
 * a database exists, let alone which one — so it asks for a runner rather than
 * for a TypeORM `EntityManager`.
 */
export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');
