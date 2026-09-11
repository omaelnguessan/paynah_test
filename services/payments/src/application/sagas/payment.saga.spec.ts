import { PAYMENT_EXECUTION } from '../../domain/ports/payment-execution.port';
import { Test } from '@nestjs/testing';
import { CommandBus } from '@nestjs/cqrs';
import { AccountsUnavailableError } from '../../domain/errors/accounts-unavailable.error';
import { InsufficientBalanceError } from '../../domain/errors/insufficient-balance.error';
import { Reference } from '../../domain/model/reference';
import { CompensatePaymentCommand } from '../commands/compensate-payment.command';
import { CreditDestinationWalletCommand } from '../commands/credit-destination-wallet.command';
import { DebitSourceWalletCommand } from '../commands/debit-source-wallet.command';
import { PaymentSaga } from './payment.saga';

const REFERENCE = Reference.of('pay', 'pay_01hq3m8x0000zt7k9d2v4bqf1c');

describe('PaymentSaga', () => {
  const commands = { execute: jest.fn() };
  let saga: PaymentSaga;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: PAYMENT_EXECUTION,
          useValue: { run: (_key: string, work: () => Promise<unknown>) => work() },
        },
        PaymentSaga,
        { provide: CommandBus, useValue: commands },
      ],
    }).compile();
    saga = moduleRef.get(PaymentSaga);
  });

  const issued = () => commands.execute.mock.calls.map(([command]) => command.constructor);

  it('debits then credits when both succeed', async () => {
    commands.execute.mockResolvedValue('trx_x');

    await saga.run(REFERENCE);

    expect(issued()).toEqual([DebitSourceWalletCommand, CreditDestinationWalletCommand]);
  });

  it('stops after a refused debit, without compensating', async () => {
    commands.execute.mockRejectedValueOnce(new InsufficientBalanceError('wlt_x'));

    await saga.run(REFERENCE);

    // Nothing moved, so there is nothing to give back.
    expect(issued()).toEqual([DebitSourceWalletCommand]);
  });

  it('stops after an unavailable upstream at the debit step', async () => {
    commands.execute.mockRejectedValueOnce(new AccountsUnavailableError('debit'));

    await saga.run(REFERENCE);

    expect(issued()).toEqual([DebitSourceWalletCommand]);
  });

  it('compensates when the credit fails after a successful debit', async () => {
    commands.execute
      .mockResolvedValueOnce('trx_debit')
      .mockRejectedValueOnce(new AccountsUnavailableError('credit'))
      .mockResolvedValueOnce('trx_refund');

    await saga.run(REFERENCE);

    expect(issued()).toEqual([
      DebitSourceWalletCommand,
      CreditDestinationWalletCommand,
      CompensatePaymentCommand,
    ]);
  });

  it('lets an unexpected failure surface rather than swallowing it', async () => {
    commands.execute.mockRejectedValueOnce(new Error('the process is on fire'));

    await expect(saga.run(REFERENCE)).rejects.toThrow('the process is on fire');
    expect(issued()).toEqual([DebitSourceWalletCommand]);
  });

  it('addresses every command to the same payment', async () => {
    commands.execute
      .mockResolvedValueOnce('trx_debit')
      .mockRejectedValueOnce(new AccountsUnavailableError('credit'))
      .mockResolvedValueOnce('trx_refund');

    await saga.run(REFERENCE);

    for (const [command] of commands.execute.mock.calls) {
      expect(command.paymentReference).toBe(REFERENCE.value);
    }
  });
});
