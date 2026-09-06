import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { DomainError } from '../../../domain/errors/domain.error';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { Reference } from '../../../domain/model/reference';
import { ACCOUNTS_PORT, AccountsPort } from '../../../domain/ports/accounts.port';
import {
  PAYMENT_REPOSITORY,
  PaymentRepository,
} from '../../../domain/ports/payment.repository';
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
 */
@CommandHandler(DebitSourceWalletCommand)
export class DebitSourceWalletHandler implements ICommandHandler<DebitSourceWalletCommand> {
  private readonly logger = new Logger(DebitSourceWalletHandler.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    private readonly events: EventBus,
  ) {}

  async execute(command: DebitSourceWalletCommand): Promise<string> {
    const payment = await this.payments.findByReference(Reference.of('pay', command.paymentReference));
    if (!payment) {
      throw new PaymentNotFoundError(command.paymentReference);
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
      payment.decline(failureReasonOf(error));
      await this.transaction.run(() => this.payments.save(payment));
      this.events.publishAll(payment.pullEvents());

      this.logger.warn(
        { payment_reference: payment.reference.value, failure_reason: payment.failureReason },
        'payment declined at the debit step',
      );
      throw error;
    }
  }
}
