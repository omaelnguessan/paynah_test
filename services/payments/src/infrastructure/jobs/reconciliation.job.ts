import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommandBus } from '@nestjs/cqrs';
import { PaymentStatus } from '../../domain/model/payment-status';
import { PAYMENT_REPOSITORY, PaymentRepository } from '../../domain/ports/payment.repository';
import { CompensatePaymentCommand } from '../../application/commands/compensate-payment.command';

/** A payment still Processing after this long lost its saga to a crash. */
const STUCK_AFTER_MS = 5 * 60 * 1000;
const BATCH_SIZE = 20;

/**
 * Recovers interrupted payments. Processing may hide a successful credit:
 * the handler resolves that outcome before deciding anything. Only confirmed
 * refund decisions in CompensationPending are retried as refunds.
 */
@Injectable()
export class ReconciliationJob {
  private readonly logger = new Logger(ReconciliationJob.name);
  private running = false;

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly commands: CommandBus,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'reconciliation' })
  async reconcile(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const stuck = await this.payments.findStuck(
        [PaymentStatus.Processing, PaymentStatus.CompensationPending],
        new Date(Date.now() - STUCK_AFTER_MS),
        BATCH_SIZE,
      );

      if (stuck.length === 0) {
        return;
      }
      this.logger.warn({ count: stuck.length }, 'reconciling payments left in flight');

      for (const payment of stuck) {
        try {
          await this.commands.execute(new CompensatePaymentCommand(payment.reference.value));
        } catch (error) {
          this.logger.error(
            {
              payment_reference: payment.reference.value,
              status: payment.status,
              cause: error instanceof Error ? error.message : String(error),
            },
            'reconciliation failed for this payment',
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
