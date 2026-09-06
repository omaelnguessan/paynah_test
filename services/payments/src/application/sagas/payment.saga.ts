import { Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { DomainError } from '../../domain/errors/domain.error';
import { Reference } from '../../domain/model/reference';
import { CompensatePaymentCommand } from '../commands/compensate-payment.command';
import { CreditDestinationWalletCommand } from '../commands/credit-destination-wallet.command';
import { DebitSourceWalletCommand } from '../commands/debit-source-wallet.command';

/**
 * The orchestration, and nothing else.
 *
 * Each step is a command with its own transaction; the saga only decides what
 * happens next. A debit that fails ends the payment — the debit handler has
 * already declined it. A credit that fails cannot: the source is already short,
 * so the only correct answer is to give the money back.
 */
@Injectable()
export class PaymentSaga {
  private readonly logger = new Logger(PaymentSaga.name);

  constructor(private readonly commands: CommandBus) {}

  async run(reference: Reference): Promise<void> {
    try {
      await this.commands.execute(new DebitSourceWalletCommand(reference.value));
    } catch (error) {
      if (error instanceof DomainError) {
        // Already recorded as Declined by the debit step; nothing moved.
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
        'credit failed after the debit went through, compensating',
      );
      await this.commands.execute(new CompensatePaymentCommand(reference.value));
    }
  }
}
