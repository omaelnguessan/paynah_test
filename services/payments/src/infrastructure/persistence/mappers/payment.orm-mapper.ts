import { Payment, PaymentSnapshot } from '../../../domain/model/payment';
import { FailureReason, PaymentStatus } from '../../../domain/model/payment-status';
import { PaymentOrmEntity } from '../entities/payment.orm-entity';

/** Maps between Payment and its persistence representation. */
export class PaymentOrmMapper {
  static toDomain(row: PaymentOrmEntity): Payment {
    const snapshot: PaymentSnapshot = {
      reference: row.reference,
      transactionId: row.transaction_id,
      amount: row.amount,
      currency: row.currency,
      sourceWallet: row.source_wallet_reference,
      destinationWallet: row.destination_wallet_reference,
      description: row.description,
      status: row.status as PaymentStatus,
      failureReason: row.failure_reason as FailureReason | null,
      debitTransactionReference: row.debit_transaction_reference,
      creditTransactionReference: row.credit_transaction_reference,
      refundTransactionReference: row.refund_transaction_reference,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
    return Payment.restore(snapshot);
  }

  static toPersistence(payment: Payment): Partial<PaymentOrmEntity> {
    const snapshot = payment.toSnapshot();
    return {
      reference: snapshot.reference,
      transaction_id: snapshot.transactionId,
      amount: snapshot.amount,
      currency: snapshot.currency,
      source_wallet_reference: snapshot.sourceWallet,
      destination_wallet_reference: snapshot.destinationWallet,
      description: snapshot.description,
      status: snapshot.status,
      failure_reason: snapshot.failureReason,
      debit_transaction_reference: snapshot.debitTransactionReference,
      credit_transaction_reference: snapshot.creditTransactionReference,
      refund_transaction_reference: snapshot.refundTransactionReference,
      metadata: snapshot.metadata,
      completed_at: snapshot.completedAt,
    };
  }
}
