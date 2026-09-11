import { Injectable } from '@nestjs/common';
import { EventPattern } from '@paynad/shared';
import { Payment } from '../../domain/model/payment';
import { LedgerMovement, TransactionsPort } from '../../domain/ports/transactions.port';
import { OUTBOX_MESSAGE_STATUS } from './outbox.constants';
import { OutboxRepository } from '../../domain/ports/outbox.repository';
import { Inject } from '@nestjs/common';
import { OUTBOX_REPOSITORY } from '../../domain/ports/outbox.repository';
import { CorrelationContext } from '../http/correlation.context';

/** Writes ledger messages to the outbox within the payment transaction. */
@Injectable()
export class TransactionsOutboxAdapter implements TransactionsPort {
  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    private readonly correlation: CorrelationContext,
  ) {}

  async record(payment: Payment, movements: readonly LedgerMovement[]): Promise<void> {
    const correlationId = this.correlation.current;

    await this.outbox.enqueue(
      movements.map((movement) => ({
        aggregateReference: payment.reference.value,
        eventType: EventPattern.TRANSACTION_RECORDED,
        payload: {
          transaction_id: movement.transactionId,
          payment_reference: movement.paymentReference.value,
          type: movement.type,
          wallet_reference: movement.wallet.value,
          user_reference: payment.metadata?.user_reference ?? UNKNOWN_USER,
          amount: payment.money.amount,
          currency: payment.money.currency,
          description: payment.description,
          status: OUTBOX_MESSAGE_STATUS,
          occurred_at: movement.occurredAt.toISOString(),
          correlation_id: correlationId,
          emitted_at: new Date().toISOString(),
        },
      })),
    );
  }
}

/**
 * `payments` never learns who owns a wallet — that is `accounts`' business — so
 * the caller may pass the user reference in `metadata`. When it does not, the
 * ledger row still records the movement against its wallet.
 */
const UNKNOWN_USER = 'usr_00000000000000000000000000';
