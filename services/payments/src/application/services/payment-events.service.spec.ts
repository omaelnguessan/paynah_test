import { Test } from '@nestjs/testing';
import { PaymentApprovedEvent } from '../../domain/events/payment-approved.event';
import { PaymentCompensatedEvent } from '../../domain/events/payment-compensated.event';
import { PaymentDeclinedEvent } from '../../domain/events/payment-declined.event';
import { Currency, Money } from '../../domain/model/money';
import { FailureReason } from '../../domain/model/payment-status';
import { Reference } from '../../domain/model/reference';
import { OUTBOX_REPOSITORY } from '../../domain/ports/outbox.repository';
import { CREDIT, DEBIT, REFUND } from '../../testing/doubles';
import { PaymentEvents } from './payment-events.service';

const PAYMENT = Reference.of('pay', 'pay_01hq3m8x0000zt7k9d2v4bqf1c');
const MONEY = Money.of(5_000, Currency.XOF);
const OCCURRED_AT = new Date('2026-04-01T10:00:00.000Z');

describe('the transactional lifecycle writer', () => {
  const outbox = { enqueue: jest.fn() };

  async function handlers() {
    const moduleRef = await Test.createTestingModule({
      providers: [PaymentEvents, { provide: OUTBOX_REPOSITORY, useValue: outbox }],
    }).compile();
    return {
      approved: moduleRef.get(PaymentEvents),
      declined: moduleRef.get(PaymentEvents),
      compensated: moduleRef.get(PaymentEvents),
    };
  }

  beforeEach(() => jest.resetAllMocks());

  const enqueued = () => outbox.enqueue.mock.calls[0][0][0];

  it('queues an approval, rather than publishing it to the broker itself', async () => {
    const { approved } = await handlers();

    await approved.enqueue([new PaymentApprovedEvent(PAYMENT, MONEY, DEBIT, CREDIT, OCCURRED_AT)]);

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueued()).toMatchObject({
      aggregateReference: PAYMENT.value,
      eventType: 'payment.approved',
      payload: {
        payment_reference: PAYMENT.value,
        amount: 5_000,
        occurred_at: OCCURRED_AT.toISOString(),
      },
    });
  });

  it('queues a decline with the reason that caused it', async () => {
    const { declined } = await handlers();

    await declined.enqueue([
      new PaymentDeclinedEvent(PAYMENT, MONEY, FailureReason.INSUFFICIENT_BALANCE, OCCURRED_AT),
    ]);

    expect(enqueued()).toMatchObject({
      eventType: 'payment.declined',
      payload: { failure_reason: FailureReason.INSUFFICIENT_BALANCE },
    });
  });

  it('queues a compensation with the refund movement', async () => {
    const { compensated } = await handlers();

    await compensated.enqueue([new PaymentCompensatedEvent(PAYMENT, MONEY, REFUND, OCCURRED_AT)]);

    expect(enqueued()).toMatchObject({
      eventType: 'payment.compensated',
      payload: { refund_transaction_reference: REFUND.value },
    });
  });

  it('lets a failed write surface, so the surrounding transaction rolls back', async () => {
    const { approved } = await handlers();
    outbox.enqueue.mockRejectedValue(new Error('the outbox insert failed'));

    await expect(
      approved.enqueue([new PaymentApprovedEvent(PAYMENT, MONEY, DEBIT, CREDIT, OCCURRED_AT)]),
    ).rejects.toThrow('the outbox insert failed');
  });
});
