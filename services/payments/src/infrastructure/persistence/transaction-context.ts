import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, EntityManager } from 'typeorm';
import { TransactionRunner } from '../../domain/ports/transaction-runner.port';

/**
 * Implements the domain's `TransactionRunner`.
 *
 * The ambient `EntityManager` is carried in async storage rather than threaded
 * through every signature, so a repository joins the caller's transaction
 * without the application layer ever handling one — `TransactionRunner.run` is
 * all it knows about atomicity.
 */
@Injectable()
export class TransactionContext implements TransactionRunner {
  private readonly storage = new AsyncLocalStorage<EntityManager>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    const running = this.storage.getStore();
    // Already inside a transaction: join it rather than opening a nested one.
    if (running) {
      return work();
    }
    return this.dataSource.transaction((manager) => this.storage.run(manager, work));
  }

  /** The manager a repository should use: the ambient one, or the default. */
  get manager(): EntityManager {
    return this.storage.getStore() ?? this.dataSource.manager;
  }
}
