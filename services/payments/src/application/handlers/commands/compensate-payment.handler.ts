import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { DomainError } from '../../../domain/errors/domain.error';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { FailureReason, PaymentStatus } from '../../../domain/model/payment-status';
import { Reference } from '../../../domain/model/reference';
import { ACCOUNTS_PORT, AccountsPort } from '../../../domain/ports/accounts.port';
import {
  PAYMENT_REPOSITORY,
  PaymentRepository,
} from '../../../domain/ports/payment.repository';
import {
  TRANSACTIONS_PORT,
  TransactionsPort,
} from '../../../domain/ports/transactions.port';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '../../../domain/ports/transaction-runner.port';
import { CompensatePaymentCommand } from '../../commands/compensate-payment.command';

/**
 * Puts the money back where it came from.
 *
 * Called by the saga when the credit fails, and again by the reconciler for any
 * payment left owing a refund. It is safe to run twice: the refund carries the
 * payment's `:refund` idempotency key, so `accounts` applies it once whatever
 * happens here.
 */
@CommandHandler(CompensatePaymentCommand)
export class CompensatePaymentHandler implements ICommandHandler<CompensatePaymentCommand> {
  private readonly logger = new Logger(CompensatePaymentHandler.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
    @Inject(TRANSACTIONS_PORT) private readonly ledger: TransactionsPort,
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    private readonly events: EventBus,
  ) {}

  async execute(command: CompensatePaymentCommand): Promise<string | null> {
    const payment = await this.payments.findByReference(Reference.of('pay', command.paymentReference));
    if (!payment) {
      throw new PaymentNotFoundError(command.paymentReference);
    }
    if (payment.status === PaymentStatus.Compensated) {
      return payment.refundTransactionReference?.value ?? null;
    }

    try {
      const refund = await this.accounts.credit(
        payment.source,
        payment.money,
        payment.movementKey('refund'),
        // The payment reference travels in its own field; the description has a
        // whitelist that no reference could satisfy.
        { description: 'Refund of a failed payment', paymentReference: payment.reference },
      );

      payment.compensate(refund.transactionReference);
      await this.transaction.run(async () => {
        await this.payments.save(payment);
        await this.ledger.record(payment, [
          {
            transactionId: payment.movementKey('refund'),
            paymentReference: payment.reference,
            type: 'REFUND' as const,
            wallet: payment.source,
            movementReference: refund.transactionReference,
            occurredAt: payment.completedAt ?? new Date(),
          },
        ]);
      });
      this.events.publishAll(payment.pullEvents());

      this.logger.log(
        {
          payment_reference: payment.reference.value,
          refund_transaction_reference: refund.transactionReference.value,
        },
        'payment compensated',
      );
      return refund.transactionReference.value;
    } catch (error) {
      if (payment.status !== PaymentStatus.CompensationPending) {
        payment.markCompensationPending(FailureReason.CREDIT_FAILED);
        await this.transaction.run(() => this.payments.save(payment));
      }

      // Money is sitting in the wrong place. This is the one situation in the
      // whole service that needs a human if the reconciler keeps failing.
      this.logger.error(
        {
          payment_reference: payment.reference.value,
          source_wallet_reference: payment.source.value,
          amount: payment.money.amount,
          currency: payment.money.currency,
          cause: error instanceof DomainError ? error.code : String(error),
        },
        'COMPENSATION FAILED — the source wallet is still short and needs a refund',
      );
      return null;
    }
  }
}
