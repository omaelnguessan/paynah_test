import { Inject, Injectable } from '@nestjs/common';
import { DomainEvent } from '../../domain/events/domain-event';
import { OUTBOX_REPOSITORY, OutboxRepository } from '../../domain/ports/outbox.repository';

/** Called and awaited inside the transaction that saves the payment. */
@Injectable()
export class PaymentEvents {
  constructor(@Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository) {}

  async enqueue(events: readonly DomainEvent[]): Promise<void> {
    await this.outbox.enqueue(
      events.map((event) => ({
        aggregateReference: event.aggregateReference,
        eventType: event.type,
        payload: { ...event.payload(), occurred_at: event.occurredAt.toISOString() },
      })),
    );
  }
}
