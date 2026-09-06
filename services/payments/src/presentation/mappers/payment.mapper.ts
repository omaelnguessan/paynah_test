import { InitiatePaymentCommand } from '../../application/commands/initiate-payment.command';
import { Currency } from '../../domain/model/money';
import { PaymentStatus } from '../../domain/model/payment-status';
import { PaymentView } from '../../domain/ports/payment-read.port';
import { InitiatePaymentRequest } from '../dto/initiate-payment.request';
import { PaymentResponse } from '../dto/payment.response';

/**
 * The explicit boundary between the wire and the application.
 *
 * Request → command on the way in, read model → response on the way out. Three
 * separate shapes, two mappers, no shortcut: this is what keeps a
 * `class-validator` decorator out of the command and a `@Column()` out of the
 * aggregate.
 */
export class PaymentMapper {
  static toCommand(request: InitiatePaymentRequest): InitiatePaymentCommand {
    return new InitiatePaymentCommand(
      request.transaction_id,
      request.source_wallet_reference,
      request.destination_wallet_reference,
      request.amount,
      request.currency as unknown as Currency,
      request.description,
      request.lang,
      request.metadata ?? null,
    );
  }

  static toResponse(view: PaymentView): PaymentResponse {
    return {
      reference: view.reference,
      transaction_id: view.transaction_id,
      amount: view.amount,
      currency: view.currency as PaymentResponse['currency'],
      description: view.description,
      source_wallet_reference: view.source_wallet_reference,
      destination_wallet_reference: view.destination_wallet_reference,
      status: view.status as PaymentStatus,
      failure_reason: view.failure_reason,
      debit_transaction_reference: view.debit_transaction_reference,
      credit_transaction_reference: view.credit_transaction_reference,
      created_at: view.created_at.toISOString(),
      completed_at: view.completed_at ? view.completed_at.toISOString() : null,
    };
  }
}
