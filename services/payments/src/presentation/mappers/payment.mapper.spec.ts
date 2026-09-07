import { Currency } from '../../domain/model/money';
import { FailureReason, PaymentStatus } from '../../domain/model/payment-status';
import { PaymentView } from '../../domain/ports/payment-read.port';
import { InitiatePaymentRequest, Lang } from '../dto/initiate-payment.request';
import { PaymentMapper } from './payment.mapper';

const view: PaymentView = {
  reference: 'pay_01hq3m8x0000zt7k9d2v4bqf1c',
  transactionId: 'tx-00000001',
  amount: 5_000,
  currency: Currency.XOF,
  description: 'Paiement facture avril',
  sourceWallet: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c',
  destinationWallet: 'wlt_01hq3m8x0000zt7k9d2v4bqf9z',
  status: PaymentStatus.Approved,
  failureReason: null,
  debitTransactionReference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
  creditTransactionReference: 'trx_01hq3m8x0000zt7k9d2v4bqf9z',
  refundTransactionReference: null,
  createdAt: new Date('2026-04-01T10:00:00.000Z'),
  completedAt: new Date('2026-04-01T10:00:02.412Z'),
};

describe('PaymentMapper', () => {
  describe('on the way out', () => {
    it('translates domain names into the wire contract', () => {
      const response = PaymentMapper.toResponse(view);

      expect(response).toEqual({
        reference: 'pay_01hq3m8x0000zt7k9d2v4bqf1c',
        transaction_id: 'tx-00000001',
        amount: 5_000,
        currency: 'XOF',
        description: 'Paiement facture avril',
        source_wallet_reference: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c',
        destination_wallet_reference: 'wlt_01hq3m8x0000zt7k9d2v4bqf9z',
        status: PaymentStatus.Approved,
        failure_reason: null,
        debit_transaction_reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c',
        credit_transaction_reference: 'trx_01hq3m8x0000zt7k9d2v4bqf9z',
        created_at: '2026-04-01T10:00:00.000Z',
        completed_at: '2026-04-01T10:00:02.412Z',
      });
    });

    it('leaks no domain spelling into the response', () => {
      // The projection is named the way the domain names things; the wire
      // format is snake_case. If these ever meet anywhere but here, the domain
      // has started depending on the shape of a JSON body.
      const response = PaymentMapper.toResponse(view) as unknown as Record<string, unknown>;

      for (const field of ['transactionId', 'sourceWallet', 'createdAt', 'failureReason']) {
        expect(response).not.toHaveProperty(field);
      }
      expect(Object.keys(response).every((key) => !/[A-Z]/.test(key))).toBe(true);
    });

    it('keeps a payment that has not settled open-ended', () => {
      const response = PaymentMapper.toResponse({
        ...view,
        status: PaymentStatus.Declined,
        failureReason: FailureReason.INSUFFICIENT_BALANCE,
        debitTransactionReference: null,
        creditTransactionReference: null,
        completedAt: null,
      });

      expect(response.failure_reason).toBe('INSUFFICIENT_BALANCE');
      expect(response.debit_transaction_reference).toBeNull();
      expect(response.completed_at).toBeNull();
    });
  });

  describe('on the way in', () => {
    it('turns a validated request into plain command data', () => {
      const request: InitiatePaymentRequest = {
        transaction_id: 'tx-00000001',
        source_wallet_reference: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c',
        destination_wallet_reference: 'wlt_01hq3m8x0000zt7k9d2v4bqf9z',
        amount: 5_000,
        currency: Currency.XOF as never,
        description: 'Paiement facture avril',
        lang: Lang.FR,
        metadata: { user_reference: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' },
      };

      const command = PaymentMapper.toCommand(request);

      expect(command.transactionId).toBe('tx-00000001');
      expect(command.sourceWallet).toBe('wlt_01hq3m8x0000zt7k9d2v4bqf1c');
      expect(command.metadata).toEqual({ user_reference: 'usr_01hq3m8x0000zt7k9d2v4bqf1c' });
      // A command carries data, never a decorator: nothing of the DTO survives.
      expect(Object.getPrototypeOf(command).constructor.name).toBe('InitiatePaymentCommand');
    });

    it('normalises an absent metadata to an explicit null', () => {
      const command = PaymentMapper.toCommand({
        transaction_id: 'tx-00000002',
        source_wallet_reference: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c',
        destination_wallet_reference: 'wlt_01hq3m8x0000zt7k9d2v4bqf9z',
        amount: 5_000,
        currency: Currency.XOF as never,
        description: 'Sans metadata',
        lang: Lang.EN,
      } as InitiatePaymentRequest);

      expect(command.metadata).toBeNull();
    });
  });
});
