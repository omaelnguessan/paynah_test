import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern as OnEvent, Payload, RmqContext } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EventPattern, PaymentTransactionRecordedEvent } from '@paynad/shared';
import { RecordTransactionRequest } from './dto/record-transaction.request';
import { TransactionsService } from './transactions.service';

interface Channel {
  ack(message: unknown): void;
  nack(message: unknown, allUpTo: boolean, requeue: boolean): void;
}

/**
 * The primary way movements reach the ledger; the HTTP POST is the fallback.
 *
 * Acknowledgement is manual and deliberate:
 * - appended, or already known → ack;
 * - malformed payload → ack, because redelivering it forever would only build a
 *   poison loop; the payload is logged so it can be replayed by hand;
 * - anything else (the database is down, say) → nack with requeue, since the
 *   next delivery has a real chance of succeeding.
 */
@Controller()
export class TransactionsEventsController {
  private readonly logger = new Logger(TransactionsEventsController.name);

  constructor(private readonly transactions: TransactionsService) {}

  @OnEvent(EventPattern.TRANSACTION_RECORDED)
  async onTransactionRecorded(
    @Payload() event: PaymentTransactionRecordedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage();

    const request = plainToInstance(RecordTransactionRequest, event, {
      excludeExtraneousValues: false,
    });
    const errors = await validate(request, {
      whitelist: true,
      forbidNonWhitelisted: false,
      stopAtFirstError: false,
    });

    if (errors.length > 0) {
      this.logger.error(
        {
          correlation_id: event.correlation_id,
          fields: errors.map((error) => error.property),
        },
        `discarding a malformed ${EventPattern.TRANSACTION_RECORDED}`,
      );
      channel.ack(message);
      return;
    }

    try {
      const { transaction, created } = await this.transactions.record(request);
      // The correlation id rides on the event, so a queue-driven append shows up
      // under the same grep as the HTTP calls that caused it.
      this.logger.log(
        {
          correlation_id: event.correlation_id,
          payment_reference: request.payment_reference,
          transaction_id: request.transaction_id,
          reference: transaction.reference,
        },
        created ? 'movement appended to the ledger' : 'movement already recorded, ignoring replay',
      );
      channel.ack(message);
    } catch (error) {
      this.logger.error(
        {
          correlation_id: event.correlation_id,
          transaction_id: request.transaction_id,
          cause: error instanceof Error ? error.message : String(error),
        },
        'could not record the movement, requeueing',
      );
      channel.nack(message, false, true);
    }
  }
}
