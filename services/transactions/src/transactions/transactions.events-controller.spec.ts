import { Test } from '@nestjs/testing';
import { RmqContext } from '@nestjs/microservices';
import { Currency, PaymentTransactionRecordedEvent, TransactionStatus, TransactionType } from '@paynad/shared';
import { TransactionsEventsController } from './transactions.events-controller';
import { TransactionsService } from './transactions.service';

function eventFixture(
  overrides: Partial<PaymentTransactionRecordedEvent> = {},
): PaymentTransactionRecordedEvent {
  return {
    transaction_id: 'tx-00000001',
    correlation_id: 'corr-0001',
    emitted_at: '2026-09-06T10:15:01.000Z',
    payment_reference: 'pay_01hq3m8x0000zt7k9d2v4bqf1c',
    type: TransactionType.CREDIT,
    wallet_reference: 'wlt_01hq3m8x0000zt7k9d2v4bqf1c',
    user_reference: 'usr_01hq3m8x0000zt7k9d2v4bqf1c',
    amount: 2_500,
    currency: Currency.XOF,
    description: 'Credit via the queue',
    status: TransactionStatus.APPROVED,
    occurred_at: '2026-09-06T10:15:00.000Z',
    ...overrides,
  };
}

describe('TransactionsEventsController', () => {
  const channel = { ack: jest.fn(), nack: jest.fn() };
  const message = { fields: { deliveryTag: 1 } };
  const context = {
    getChannelRef: () => channel,
    getMessage: () => message,
  } as unknown as RmqContext;

  const transactions = { record: jest.fn() };
  let controller: TransactionsEventsController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [TransactionsEventsController],
      providers: [{ provide: TransactionsService, useValue: transactions }],
    }).compile();
    controller = moduleRef.get(TransactionsEventsController);
  });

  it('records the movement and acknowledges the message', async () => {
    transactions.record.mockResolvedValue({
      transaction: { reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c' },
      created: true,
    });

    await controller.onTransactionRecorded(eventFixture(), context);

    expect(transactions.record).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_id: 'tx-00000001', amount: 2_500 }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('acknowledges a redelivery of an already recorded movement', async () => {
    transactions.record.mockResolvedValue({
      transaction: { reference: 'trx_01hq3m8x0000zt7k9d2v4bqf1c' },
      created: false,
    });

    await controller.onTransactionRecorded(eventFixture(), context);

    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('discards a malformed event rather than building a poison loop', async () => {
    await controller.onTransactionRecorded(
      eventFixture({ amount: 7, type: 'SIDEWAYS' as TransactionType }),
      context,
    );

    expect(transactions.record).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('requeues when the failure is transient, since a retry can succeed', async () => {
    transactions.record.mockRejectedValue(new Error('connection terminated'));

    await controller.onTransactionRecorded(eventFixture(), context);

    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
