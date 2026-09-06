import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { DomainEvent } from '../../../domain/events/domain-event';
import { PaymentApprovedEvent } from '../../../domain/events/payment-approved.event';
import { PaymentCompensatedEvent } from '../../../domain/events/payment-compensated.event';
import { PaymentDeclinedEvent } from '../../../domain/events/payment-declined.event';
import {
  OUTBOX_REPOSITORY,
  OutboxRepository,
} from '../../../domain/ports/outbox.repository';

/**
 * Lifecycle events reach the broker through the outbox, never by calling
 * RabbitMQ here: a handler that published directly would make the payment's
 * success depend on the broker being up at that exact moment.
 */
abstract class OutboxWritingHandler {
  protected readonly logger = new Logger(this.constructor.name);

  protected constructor(private readonly outbox: OutboxRepository) {}

  protected async enqueue(event: DomainEvent): Promise<void> {
    await this.outbox.enqueue([
      {
        aggregateReference: event.aggregateReference,
        eventType: event.type,
        payload: { ...event.payload(), occurred_at: event.occurredAt.toISOString() },
      },
    ]);
    this.logger.log(
      { payment_reference: event.aggregateReference, event_type: event.type },
      'lifecycle event queued for publication',
    );
  }
}

@EventsHandler(PaymentApprovedEvent)
export class PaymentApprovedHandler
  extends OutboxWritingHandler
  implements IEventHandler<PaymentApprovedEvent>
{
  constructor(@Inject(OUTBOX_REPOSITORY) outbox: OutboxRepository) {
    super(outbox);
  }

  handle(event: PaymentApprovedEvent): Promise<void> {
    return this.enqueue(event);
  }
}

@EventsHandler(PaymentDeclinedEvent)
export class PaymentDeclinedHandler
  extends OutboxWritingHandler
  implements IEventHandler<PaymentDeclinedEvent>
{
  constructor(@Inject(OUTBOX_REPOSITORY) outbox: OutboxRepository) {
    super(outbox);
  }

  handle(event: PaymentDeclinedEvent): Promise<void> {
    return this.enqueue(event);
  }
}

@EventsHandler(PaymentCompensatedEvent)
export class PaymentCompensatedHandler
  extends OutboxWritingHandler
  implements IEventHandler<PaymentCompensatedEvent>
{
  constructor(@Inject(OUTBOX_REPOSITORY) outbox: OutboxRepository) {
    super(outbox);
  }

  handle(event: PaymentCompensatedEvent): Promise<void> {
    return this.enqueue(event);
  }
}
