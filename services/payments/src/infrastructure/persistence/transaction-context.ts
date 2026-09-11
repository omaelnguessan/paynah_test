import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { TransactionRunner } from '../../domain/ports/transaction-runner.port';

/**
 * Shares the transaction manager through AsyncLocalStorage.
 * Saga steps reuse the lock-owning connection for separate local transactions.
 */
@Injectable()
export class TransactionContext implements TransactionRunner {
  private readonly connection = new AsyncLocalStorage<QueryRunner>();
  private readonly storage = new AsyncLocalStorage<EntityManager>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  withConnection<T>(runner: QueryRunner, work: () => Promise<T>): Promise<T> {
    return this.connection.run(runner, work);
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const running = this.storage.getStore();
    // Already inside a transaction: join it rather than opening a nested one.
    if (running) {
      return work();
    }
    const runner = this.connection.getStore();
    if (!runner) return this.dataSource.transaction((manager) => this.storage.run(manager, work));
    // Reuse the lock-owning session, avoiding pool starvation when many sagas
    // run together. Each step still commits before its remote call.
    await runner.startTransaction();
    try {
      const result = await this.storage.run(runner.manager, work);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    }
  }

  /** The manager a repository should use: the ambient one, or the default. */
  get manager(): EntityManager {
    return this.storage.getStore() ?? this.dataSource.manager;
  }
}
