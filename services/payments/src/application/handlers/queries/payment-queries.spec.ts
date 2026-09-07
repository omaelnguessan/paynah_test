import { Test } from '@nestjs/testing';
import { PaymentNotFoundError } from '../../../domain/errors/payment.errors';
import { Currency } from '../../../domain/model/money';
import { PaymentStatus } from '../../../domain/model/payment-status';
import { PAYMENT_READ_PORT, PaymentView } from '../../../domain/ports/payment-read.port';
import { GetPaymentByReferenceQuery } from '../../queries/get-payment-by-reference.query';
import { ListPaymentsQuery } from '../../queries/list-payments.query';
import { GetPaymentByReferenceHandler } from './get-payment-by-reference.handler';
import { ListPaymentsHandler } from './list-payments.handler';

const REFERENCE = 'pay_01hq3m8x0000zt7k9d2v4bqf1c';

/** A projection in the domain's own vocabulary, spelled out rather than cast. */
const view: PaymentView = {
  reference: REFERENCE,
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

describe('the read side', () => {
  const payments = { findByReference: jest.fn(), findPage: jest.fn() };
  let one: GetPaymentByReferenceHandler;
  let many: ListPaymentsHandler;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GetPaymentByReferenceHandler,
        ListPaymentsHandler,
        { provide: PAYMENT_READ_PORT, useValue: payments },
      ],
    }).compile();
    one = moduleRef.get(GetPaymentByReferenceHandler);
    many = moduleRef.get(ListPaymentsHandler);
  });

  describe('reading one payment', () => {
    it('returns the projection as it stands, hydrating no aggregate', async () => {
      payments.findByReference.mockResolvedValue(view);

      await expect(one.execute(new GetPaymentByReferenceQuery(REFERENCE))).resolves.toBe(view);
      expect(payments.findByReference).toHaveBeenCalledWith(REFERENCE);
    });

    it('reports an unknown reference', async () => {
      payments.findByReference.mockResolvedValue(null);

      await expect(
        one.execute(new GetPaymentByReferenceQuery(REFERENCE)),
      ).rejects.toBeInstanceOf(PaymentNotFoundError);
    });
  });

  describe('listing payments', () => {
    it('passes the filter straight through to the projection', async () => {
      payments.findPage.mockResolvedValue({ items: [view], total: 1 });

      const result = await many.execute(
        new ListPaymentsQuery(2, 25, PaymentStatus.Approved, 'wlt_01hq3m8x0000zt7k9d2v4bqf1c'),
      );

      expect(result).toEqual({ items: [view], total: 1 });
      expect(payments.findPage).toHaveBeenCalledWith({
        page: 2,
        perPage: 25,
        status: PaymentStatus.Approved,
        sourceWallet: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c',
      });
    });

    it('defaults to no filtering at all', async () => {
      payments.findPage.mockResolvedValue({ items: [], total: 0 });

      await many.execute(new ListPaymentsQuery(1, 10));

      expect(payments.findPage).toHaveBeenCalledWith({
        page: 1,
        perPage: 10,
        status: null,
        sourceWallet: null,
      });
    });
  });
});
