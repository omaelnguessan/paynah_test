import { PaymentEvents } from '../../services/payment-events.service';
import { InvalidTransitionError } from '../../../domain/errors/invalid-transition.error';
import { PaymentStatus } from '../../../domain/model/payment-status';
import { PAYMENT_EXECUTION, PaymentExecution } from '../../../domain/ports/payment-execution.port';
import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AccountsUnavailableError } from '../../../domain/errors/accounts-unavailable.error';
import { DomainError } from '../../../domain/errors/domain.error';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { Reference } from '../../../domain/model/reference';
import { ACCOUNTS_PORT, AccountsPort } from '../../../domain/ports/accounts.port';
import { PAYMENT_REPOSITORY, PaymentRepository } from '../../../domain/ports/payment.repository';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '../../../domain/ports/transaction-runner.port';
import { DebitSourceWalletCommand } from '../../commands/debit-source-wallet.command';
import { failureReasonOf } from '../../services/failure-reason';

/**
 * Saga steps 2 to 4: move to Processing, take the money, record the movement.
 *
 * A refusal from `accounts` is a business outcome, not an exception to swallow:
 * the payment is declined and persisted, and the error is rethrown so the saga
 * stops rather than carrying on to the credit.
 *
 * An *unreachable* `accounts` is a different animal and is deliberately not
 * declined. The debit may have been applied and only its answer lost, so the
 * payment is left Processing for the reconciler to settle against the truth.
 */
@CommandHandler(DebitSourceWalletCommand)
export class DebitSourceWalletHandler implements ICommandHandler<DebitSourceWalletCommand> {
  private readonly logger = new Logger(DebitSourceWalletHandler.name);

  constructor(
    @Inject(PAYMENT_EXECUTION) private readonly execution: PaymentExecution,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    private readonly events: PaymentEvents,
  ) {}

  async execute(command: DebitSourceWalletCommand): Promise<string> {
    return this.execution.run(command.paymentReference, () => this.executeLocked(command));
  }

  private async executeLocked(command: DebitSourceWalletCommand): Promise<string> {
    const payment = await this.payments.findByReference(
      Reference.of('pay', command.paymentReference),
    );
    if (!payment) {
      throw new PaymentNotFoundError(command.paymentReference);
    }

    if (payment.status !== PaymentStatus.Pending) {
      throw new InvalidTransitionError(payment.status, PaymentStatus.Processing);
    }
    payment.markProcessing();
    await this.transaction.run(() => this.payments.save(payment));

    try {
      const movement = await this.accounts.debit(
        payment.source,
        payment.money,
        payment.movementKey('debit'),
        { description: payment.description, paymentReference: payment.reference },
      );

      payment.markDebited(movement.transactionReference);
      await this.transaction.run(() => this.payments.save(payment));

      this.logger.log(
        {
          payment_reference: payment.reference.value,
          debit_transaction_reference: movement.transactionReference.value,
        },
        'source wallet debited',
      );
      return movement.transactionReference.value;
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }

      if (error instanceof AccountsUnavailableError) {
        // A refusal and a lost answer are not the same event. `accounts` may
        // have applied the debit and failed on the way back, and declining here
        // would close the payment over money that has already left the wallet.
        // The payment stays Processing, which is exactly what the reconciler
        // looks for — it will ask `accounts` what really happened.
        this.logger.error(
          {
            payment_reference: payment.reference.value,
            source_wallet_reference: payment.source.value,
            cause: error.code,
          },
          'the debit outcome is unknown, leaving the payment for reconciliation',
        );
        throw error;
      }

      payment.decline(failureReasonOf(error));
      await this.transaction.run(async () => {
        await this.payments.save(payment);
        await this.events.enqueue(payment.pullEvents());
      });

      this.logger.warn(
        { payment_reference: payment.reference.value, failure_reason: payment.failureReason },
        'payment declined at the debit step, nothing moved',
      );
      throw error;
    }
  }
}
