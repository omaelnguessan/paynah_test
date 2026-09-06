import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan } from 'typeorm';
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
    const repository = this.dataSource.getRepository(OutboxOrmEntity);
    const pending = await repository.find({
      where: { published_at: IsNull(), attempts: LessThan(OUTBOX_MAX_ATTEMPTS) },
      order: { created_at: 'ASC' },
      take: OUTBOX_BATCH_SIZE,
    });

    for (const message of pending) {
      try {
        // `emit` resolves once the broker has accepted the message.
        await new Promise<void>((resolve, reject) => {
          this.client.emit(message.event_type, message.payload).subscribe({
            error: reject,
            complete: resolve,
          });
        });
        await repository.update(
          { id: message.id },
          { published_at: new Date(), attempts: message.attempts + 1, last_error: null },
        );
        this.logger.log(
          {
            payment_reference: message.aggregate_reference,
            event_type: message.event_type,
            correlation_id: (message.payload as { correlation_id?: string }).correlation_id,
          },
          'outbox message published',
        );
      } catch (error) {
        const attempts = message.attempts + 1;
        await repository.update(
          { id: message.id },
          { attempts, last_error: describe(error) },
        );
        const exhausted = attempts >= OUTBOX_MAX_ATTEMPTS;
        this.logger[exhausted ? 'error' : 'warn'](
          {
            payment_reference: message.aggregate_reference,
            event_type: message.event_type,
            attempts,
          },
          exhausted
            ? 'outbox message abandoned after too many attempts, it needs a human'
            : 'outbox message could not be published, will retry',
        );
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
