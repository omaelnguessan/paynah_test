import { PaymentEvents } from '../../services/payment-events.service';
import { PAYMENT_EXECUTION, PaymentExecution } from '../../../domain/ports/payment-execution.port';
import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DomainError } from '../../../domain/errors/domain.error';
import { InvalidTransitionError } from '../../../domain/errors/invalid-transition.error';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { Payment } from '../../../domain/model/payment';
import { FailureReason, PaymentStatus } from '../../../domain/model/payment-status';
import { Reference } from '../../../domain/model/reference';
import { ACCOUNTS_PORT, AccountsPort, MovementResult } from '../../../domain/ports/accounts.port';
import { PAYMENT_REPOSITORY, PaymentRepository } from '../../../domain/ports/payment.repository';
import { TRANSACTIONS_PORT, TransactionsPort } from '../../../domain/ports/transactions.port';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '../../../domain/ports/transaction-runner.port';
import { CompensatePaymentCommand } from '../../commands/compensate-payment.command';

/**
 * Recovers uncertain movements or executes a confirmed refund.
 * Refunds use the :refund idempotency key. An uncertain destination credit must not trigger a refund.
 */
@CommandHandler(CompensatePaymentCommand)
export class CompensatePaymentHandler implements ICommandHandler<CompensatePaymentCommand> {
  private readonly logger = new Logger(CompensatePaymentHandler.name);

  constructor(
    @Inject(PAYMENT_EXECUTION) private readonly execution: PaymentExecution,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
    @Inject(TRANSACTIONS_PORT) private readonly ledger: TransactionsPort,
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    private readonly events: PaymentEvents,
  ) {}

  async execute(command: CompensatePaymentCommand): Promise<string | null> {
    return this.execution.run(command.paymentReference, () => this.executeLocked(command));
  }

  private async executeLocked(command: CompensatePaymentCommand): Promise<string | null> {
    const payment = await this.payments.findByReference(
      Reference.of('pay', command.paymentReference),
    );
    if (!payment) {
      throw new PaymentNotFoundError(command.paymentReference);
    }
    if (payment.status === PaymentStatus.Compensated) {
      return payment.refundTransactionReference?.value ?? null;
    }

    if (
      payment.status !== PaymentStatus.Processing &&
      payment.status !== PaymentStatus.CompensationPending
    ) {
      throw new InvalidTransitionError(payment.status, PaymentStatus.Compensated);
    }

    const debitWasRecorded = payment.debitTransactionReference !== null;
    if (!debitWasRecorded && !(await this.confirmDebit(payment))) {
      return null;
    }
    if (payment.status === PaymentStatus.Processing && debitWasRecorded) {
      // Processing does not prove that the destination credit failed. Even a
      // missing movement can still be in flight: never refund on that evidence.
      await this.reconcileCredit(payment);
      return null;
    }

    // Persist the refund decision before the external call, including when
    // recovering a debit whose response was lost before any credit was sent.
    if (payment.status === PaymentStatus.Processing) {
      payment.markCompensationPending(FailureReason.CREDIT_FAILED);
      await this.transaction.run(() => this.payments.save(payment));
    }

    let refund: MovementResult;
    try {
      refund = await this.accounts.credit(
        payment.source,
        payment.money,
        payment.movementKey('refund'),
        // The payment reference travels in its own field; the description has a
        // whitelist that no reference could satisfy.
        { description: 'Refund of a failed payment', paymentReference: payment.reference },
      );
    } catch (error) {
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
      await this.events.enqueue(payment.pullEvents());
    });

    this.logger.log(
      {
        payment_reference: payment.reference.value,
        refund_transaction_reference: refund.transactionReference.value,
      },
      'payment compensated',
    );
    return refund.transactionReference.value;
  }

  private async reconcileCredit(payment: Payment): Promise<void> {
    let credit: MovementResult | null;
    try {
      credit = await this.accounts.findMovement(payment.destination, payment.movementKey('credit'));
    } catch (error) {
      this.logger.warn(
        { payment_reference: payment.reference.value },
        'credit outcome unavailable; no refund issued',
      );
      return;
    }
    if (!credit) {
      this.logger.warn(
        { payment_reference: payment.reference.value },
        'credit outcome unresolved; no refund issued, reconciliation required',
      );
      return;
    }

    payment.approve(credit.transactionReference);
    await this.transaction.run(async () => {
      await this.payments.save(payment);
      await this.ledger.record(payment, [
        {
          transactionId: payment.movementKey('debit'),
          paymentReference: payment.reference,
          type: 'DEBIT',
          wallet: payment.source,
          movementReference: payment.debitTransactionReference!,
          occurredAt: payment.completedAt!,
        },
        {
          transactionId: payment.movementKey('credit'),
          paymentReference: payment.reference,
          type: 'CREDIT',
          wallet: payment.destination,
          movementReference: credit.transactionReference,
          occurredAt: payment.completedAt!,
        },
      ]);
      await this.events.enqueue(payment.pullEvents());
    });
  }

  /**
   * Checks for a source debit before refunding a payment with no recorded debit reference.
   * An unavailable lookup leaves the payment unchanged.
   */
  private async confirmDebit(payment: Payment): Promise<boolean> {
    let movement: MovementResult | null;
    try {
      movement = await this.accounts.findMovement(payment.source, payment.movementKey('debit'));
    } catch (error) {
      this.logger.warn(
        {
          payment_reference: payment.reference.value,
          cause: error instanceof DomainError ? error.code : String(error),
        },
        'cannot establish whether the source was debited, leaving the payment untouched',
      );
      return false;
    }

    if (movement) {
      // The debit was applied and only its answer was lost. Record what the
      // ledger already knows, then unwind it.
      if (payment.status === PaymentStatus.Processing) {
        payment.markDebited(movement.transactionReference);
        await this.transaction.run(() => this.payments.save(payment));
      }
      this.logger.warn(
        {
          payment_reference: payment.reference.value,
          debit_transaction_reference: movement.transactionReference.value,
        },
        'the debit had gone through after all, compensating it',
      );
      return true;
    }

    payment.decline(FailureReason.ACCOUNTS_UNAVAILABLE);
    await this.transaction.run(async () => {
      await this.payments.save(payment);
      await this.events.enqueue(payment.pullEvents());
    });
    this.logger.log(
      { payment_reference: payment.reference.value },
      'the debit never happened, declining without a refund',
    );
    return false;
  }
}
