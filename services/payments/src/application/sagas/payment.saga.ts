import { PAYMENT_EXECUTION, PaymentExecution } from '../../domain/ports/payment-execution.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { DomainError } from '../../domain/errors/domain.error';
import { Reference } from '../../domain/model/reference';
import { CompensatePaymentCommand } from '../commands/compensate-payment.command';
import { CreditDestinationWalletCommand } from '../commands/credit-destination-wallet.command';
import { DebitSourceWalletCommand } from '../commands/debit-source-wallet.command';

/**
 * Orchestrates the debit and credit. After a credit-step error, the recovery
 * handler refunds only a persisted refusal; an uncertain credit is reconciled
 * by reading its movement, never by assuming the destination received nothing.
 */
@Injectable()
export class PaymentSaga {
  private readonly logger = new Logger(PaymentSaga.name);

  constructor(
    private readonly commands: CommandBus,
    @Inject(PAYMENT_EXECUTION) private readonly execution: PaymentExecution,
  ) {}

  async run(reference: Reference): Promise<void> {
    return this.execution.run(reference.value, () => this.runLocked(reference));
  }

  private async runLocked(reference: Reference): Promise<void> {
    try {
      await this.commands.execute(new DebitSourceWalletCommand(reference.value));
    } catch (error) {
      if (error instanceof DomainError) {
        // The debit handler persisted Declined or left an uncertain result Processing.
        return;
      }
      throw error;
    }

    try {
      await this.commands.execute(new CreditDestinationWalletCommand(reference.value));
    } catch (error) {
      this.logger.warn(
        {
          payment_reference: reference.value,
          cause: error instanceof DomainError ? error.code : String(error),
        },
        'credit step failed; resolving its outcome before any refund',
      );
      await this.commands.execute(new CompensatePaymentCommand(reference.value));
    }
  }
}
