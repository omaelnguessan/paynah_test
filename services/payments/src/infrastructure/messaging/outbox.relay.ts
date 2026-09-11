import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { lastValueFrom, timeout } from 'rxjs';
import { OutboxOrmEntity } from '../persistence/entities/outbox.orm-entity';
import { OUTBOX_BATCH_SIZE, OUTBOX_MAX_ATTEMPTS } from './outbox.constants';
import { TRANSACTIONS_CLIENT } from './messaging.tokens';

/**
 * Drains the outbox into RabbitMQ.
 *
 * Publication is at-least-once by construction: a message is marked published
 * only after the broker has taken it, so a crash in between simply means the
 * next pass sends it again. Consumers are idempotent on `transaction_id`, which
 * is what makes that safe.
 */
@Injectable()
export class OutboxRelay implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private draining = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TRANSACTIONS_CLIENT) private readonly client: ClientProxy,
  ) {}

  /** Every two seconds: fast enough that the ledger feels immediate, cheap enough to idle. */
  @Cron('*/2 * * * * *', { name: 'outbox-relay' })
  async drain(): Promise<void> {
    // A pass that overruns the tick must not be joined by the next one.
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      await this.publishBatch();
    } catch (error) {
      this.logger.error({ cause: describe(error) }, 'the outbox relay pass failed');
    } finally {
      this.draining = false;
    }
  }

  private async publishBatch(): Promise<void> {
    for (let index = 0; index < OUTBOX_BATCH_SIZE; index++) {
      const found = await this.dataSource.transaction(async (manager) => {
        // Each worker owns one row until broker acknowledgement and commit.
        // A crash after acknowledgement can replay it: consumers stay idempotent.
        const [message]: OutboxOrmEntity[] = await manager.query(
          `SELECT * FROM outbox WHERE published_at IS NULL AND attempts < $1
           AND next_attempt_at <= now() ORDER BY created_at
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [OUTBOX_MAX_ATTEMPTS],
        );
        if (!message) return false;
        const repository = manager.getRepository(OutboxOrmEntity);
        try {
          await lastValueFrom(
            this.client.emit(message.event_type, message.payload).pipe(timeout(5000)),
            { defaultValue: undefined },
          );
        } catch (error) {
          const attempts = message.attempts + 1;
          await repository.update(
            { id: message.id },
            {
              attempts,
              last_error: describe(error),
              next_attempt_at: new Date(Date.now() + Math.min(3600, 2 ** attempts) * 1000),
            },
          );
          this.logger[attempts >= OUTBOX_MAX_ATTEMPTS ? 'error' : 'warn'](
            { outbox_id: message.id, payment_reference: message.aggregate_reference, attempts },
            attempts >= OUTBOX_MAX_ATTEMPTS
              ? 'OUTBOX NEEDS ATTENTION'
              : 'outbox publication deferred',
          );
          return true;
        }
        // A database error here rolls back the attempt; it must never mark a
        // broker failure or discard a message that might need redelivery.
        await repository.update(
          { id: message.id },
          {
            published_at: new Date(),
            attempts: message.attempts + 1,
            last_error: null,
          },
        );
        return true;
      });
      if (!found) break;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
