import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Money } from '../../../domain/model/money';
import { Payment } from '../../../domain/model/payment';
import { Reference } from '../../../domain/model/reference';
import { PAYMENT_REPOSITORY, PaymentRepository } from '../../../domain/ports/payment.repository';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
} from '../../../domain/ports/transaction-runner.port';
import { InitiatePaymentCommand } from '../../commands/initiate-payment.command';
import { IdempotencyService } from '../../services/idempotency.service';
import { PaymentSaga } from '../../sagas/payment.saga';

/** A command returns a reference, never the aggregate. */
export interface InitiatePaymentResult extends Record<string, unknown> {
  reference: string;
}

@CommandHandler(InitiatePaymentCommand)
export class InitiatePaymentHandler implements ICommandHandler<InitiatePaymentCommand> {
  private readonly logger = new Logger(InitiatePaymentHandler.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    private readonly idempotency: IdempotencyService,
    private readonly saga: PaymentSaga,
  ) {}

  async execute(command: InitiatePaymentCommand): Promise<InitiatePaymentResult> {
    const outcome = await this.idempotency.execute<InitiatePaymentResult>(
      command.transactionId,
      command,
      async () => {
        const payment = Payment.initiate({
          transactionId: command.transactionId,
          money: Money.of(command.amount, command.currency),
          source: Reference.of('wlt', command.sourceWallet),
          destination: Reference.of('wlt', command.destinationWallet),
          description: command.description,
          metadata: command.metadata,
        });

        // Pending is durable before a single outbound call is made, so a crash
        // mid-saga always leaves something for the reconciler to find.
        await this.transaction.run(() => this.payments.save(payment));

        this.logger.log(
          { payment_reference: payment.reference.value, transaction_id: command.transactionId },
          'payment initiated',
        );

        return {
          result: { reference: payment.reference.value },
          paymentReference: payment.reference.value,
        };
      },
    );

    if (!outcome.replayed) {
      await this.saga.run(Reference.of('pay', outcome.result.reference));
    }
    return outcome.result;
  }
}
