import { ConcurrentPaymentError } from '../../domain/errors/concurrent-payment.error';
import { PAYMENT_EXECUTION, PaymentExecution } from '../../domain/ports/payment-execution.port';
import { PaymentSaga } from '../../application/sagas/payment.saga';
import { TERMINAL_STATUSES } from '../../domain/model/payment-status';
import { Reference } from '../../domain/model/reference';
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
    private readonly saga: PaymentSaga,
    @Inject(PAYMENT_EXECUTION) private readonly execution: PaymentExecution,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'reconciliation' })
  async reconcile(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const stuck = await this.payments.findStuck(
        [PaymentStatus.Pending, PaymentStatus.Processing, PaymentStatus.CompensationPending],
        new Date(Date.now() - STUCK_AFTER_MS),
        BATCH_SIZE,
      );

      if (stuck.length === 0) {
        return;
      }
      this.logger.warn({ count: stuck.length }, 'reconciling payments left in flight');

      for (const payment of stuck) {
        try {
          await this.recover(payment.reference);
        } catch (error) {
          if (error instanceof ConcurrentPaymentError) continue;
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
  private async recover(reference: Reference): Promise<void> {
    await this.execution.run(reference.value, async () => {
      // The batch is only a candidate list; re-read under the shared lock.
      const payment = await this.payments.findByReference(reference);
      if (!payment || TERMINAL_STATUSES.includes(payment.status)) return;
      let failure: string | null = null;
      try {
        if (payment.status === PaymentStatus.Pending) await this.saga.run(reference);
        else await this.commands.execute(new CompensatePaymentCommand(reference.value));
        const current = await this.payments.findByReference(reference);
        if (current && !TERMINAL_STATUSES.includes(current.status))
          failure = `unresolved: ${current.status}`;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      const attempts = await this.payments.recordRecoveryAttempt(reference, failure);
      if (failure) {
        this.logger[attempts >= 10 ? 'error' : 'warn'](
          { payment_reference: reference.value, attempts, cause: failure },
          attempts >= 10 ? 'RECONCILIATION NEEDS ATTENTION' : 'reconciliation deferred',
        );
      }
    });
  }
}
