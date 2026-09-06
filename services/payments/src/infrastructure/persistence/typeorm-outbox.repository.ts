import { Injectable } from '@nestjs/common';
import { OutboxMessage, OutboxRepository } from '../../domain/ports/outbox.repository';
import { OutboxOrmEntity } from './entities/outbox.orm-entity';
import { TransactionContext } from './transaction-context';

@Injectable()
export class TypeOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly context: TransactionContext) {}

  /**
   * Joins whatever transaction is running, which is the whole point: the
   * message and the state change it describes commit or roll back together.
   */
  async enqueue(messages: readonly OutboxMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    await this.context.manager.getRepository(OutboxOrmEntity).insert(
      messages.map((message) => ({
        aggregate_reference: message.aggregateReference,
        event_type: message.eventType,
        // The column is declared `object` rather than `Record<string, unknown>`:
        // TypeORM's deep-partial type recurses into an index signature and
        // refuses it, so the free-form shape is narrowed at the read sites instead.
        payload: { ...message.payload },
        published_at: null,
        attempts: 0,
      })),
    );
  }
}
