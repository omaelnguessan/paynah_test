import { PAYMENT_EXECUTION, PaymentExecution } from '../../../domain/ports/payment-execution.port';
import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InvalidTransitionError } from '../../../domain/errors/invalid-transition.error';
import { InsufficientBalanceError } from '../../../domain/errors/insufficient-balance.error';
import {
  CurrencyMismatchError,
  WalletFrozenError,
  WalletNotFoundError,
} from '../../../domain/errors/wallet.errors';
import { FailureReason, PaymentStatus } from '../../../domain/model/payment-status';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { Payment } from '../../../domain/model/payment';
import { Reference } from '../../../domain/model/reference';
import { ACCOUNTS_PORT, AccountsPort, MovementResult } from '../../../domain/ports/accounts.port';
import { PAYMENT_REPOSITORY, PaymentRepository } from '../../../domain/ports/payment.repository';
import { TRANSACTIONS_PORT, TransactionsPort } from '../../../domain/ports/transactions.port';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '../../../domain/ports/transaction-runner.port';
import { CreditDestinationWalletCommand } from '../../commands/credit-destination-wallet.command';

/**
 * Saga steps 5 to 7: credit the destination, approve the payment, and hand both
 * movements to the ledger — the approval and the outbox rows commit together,
 * so the ledger can never learn about a payment the database does not have.
 *
 * An explicit refusal permits compensation. An uncertain outcome remains
 * Processing until reconciliation establishes whether the credit landed.
 */
@CommandHandler(CreditDestinationWalletCommand)
export class CreditDestinationWalletHandler implements ICommandHandler<CreditDestinationWalletCommand> {
  private readonly logger = new Logger(CreditDestinationWalletHandler.name);

  constructor(
    @Inject(PAYMENT_EXECUTION) private readonly execution: PaymentExecution,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(ACCOUNTS_PORT) private readonly accounts: AccountsPort,
    @Inject(TRANSACTIONS_PORT) private readonly ledger: TransactionsPort,
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    private readonly events: EventBus,
  ) {}

  async execute(command: CreditDestinationWalletCommand): Promise<string> {
    return this.execution.run(command.paymentReference, () => this.executeLocked(command));
  }

  private async executeLocked(command: CreditDestinationWalletCommand): Promise<string> {
    const payment = await this.payments.findByReference(
      Reference.of('pay', command.paymentReference),
    );
    if (!payment) {
      throw new PaymentNotFoundError(command.paymentReference);
    }

    if (payment.status === PaymentStatus.Approved) {
      return payment.creditTransactionReference!.value;
    }
    if (payment.status !== PaymentStatus.Processing || !payment.debitTransactionReference) {
      throw new InvalidTransitionError(payment.status, PaymentStatus.Approved);
    }

    let movement: MovementResult;
    try {
      movement = await this.accounts.credit(
        payment.destination,
        payment.money,
        payment.movementKey('credit'),
        { description: payment.description, paymentReference: payment.reference },
      );
    } catch (error) {
      // Only an explicit refusal makes a refund safe. Transport failures and
      // local persistence failures leave Processing for outcome reconciliation.
      if (
        error instanceof WalletFrozenError ||
        error instanceof WalletNotFoundError ||
        error instanceof CurrencyMismatchError ||
        error instanceof InsufficientBalanceError
      ) {
        payment.markCompensationPending(FailureReason.CREDIT_FAILED);
        await this.transaction.run(() => this.payments.save(payment));
      }
      throw error;
    }

    payment.approve(movement.transactionReference);

    await this.transaction.run(async () => {
      await this.payments.save(payment);
      await this.ledger.record(payment, this.movementsOf(payment, movement.transactionReference));
    });
    this.events.publishAll(payment.pullEvents());

    this.logger.log(
      {
        payment_reference: payment.reference.value,
        credit_transaction_reference: movement.transactionReference.value,
      },
      'payment approved',
    );
    return movement.transactionReference.value;
  }

  /** Two ledger movements per approved payment: the debit and the credit. */
  private movementsOf(payment: Payment, creditReference: Reference) {
    const occurredAt = payment.completedAt ?? new Date();
    return [
      {
        transactionId: payment.movementKey('debit'),
        paymentReference: payment.reference,
        type: 'DEBIT' as const,
        wallet: payment.source,
        movementReference: payment.debitTransactionReference as Reference,
        occurredAt,
      },
      {
        transactionId: payment.movementKey('credit'),
        paymentReference: payment.reference,
        type: 'CREDIT' as const,
        wallet: payment.destination,
        movementReference: creditReference,
        occurredAt,
      },
    ];
  }
}
