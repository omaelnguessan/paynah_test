import { InitiatePaymentCommand } from '../../application/commands/initiate-payment.command';
import { Currency } from '../../domain/model/money';
import { PaymentView } from '../../domain/ports/payment-read.port';
import { InitiatePaymentRequest } from '../dto/initiate-payment.request';
import { PaymentResponse } from '../dto/payment.response';

/** Maps request DTOs to commands and read models to response DTOs. */
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

  /** Domain names in, wire names out. The only place the two ever meet. */
  static toResponse(view: PaymentView): PaymentResponse {
    return {
      reference: view.reference,
      transaction_id: view.transactionId,
      amount: view.amount,
      currency: view.currency as PaymentResponse['currency'],
      description: view.description,
      source_wallet_reference: view.sourceWallet,
      destination_wallet_reference: view.destinationWallet,
      status: view.status,
      failure_reason: view.failureReason,
      debit_transaction_reference: view.debitTransactionReference,
      credit_transaction_reference: view.creditTransactionReference,
      created_at: view.createdAt.toISOString(),
      completed_at: view.completedAt ? view.completedAt.toISOString() : null,
    };
  }
}
