import { PaymentExecution } from '../../domain/ports/payment-execution.port';
import { CommandBus } from '@nestjs/cqrs';
import { PaymentSaga } from '../../application/sagas/payment.saga';
import { ConcurrentPaymentError } from '../../domain/errors/concurrent-payment.error';
import { FailureReason, PaymentStatus } from '../../domain/model/payment-status';
import { PaymentRepository } from '../../domain/ports/payment.repository';
import { aPayment, aDebitedPayment, CREDIT } from '../../testing/doubles';
import { ReconciliationJob } from './reconciliation.job';

function fixture(payment = aPayment()) {
  const repository = {
    findStuck: jest.fn().mockResolvedValue([payment]),
    findByReference: jest.fn().mockResolvedValue(payment),
    recordRecoveryAttempt: jest.fn().mockResolvedValue(1),
  };
  const commands = { execute: jest.fn() };
  const saga = { run: jest.fn() };
  const execution = { run: jest.fn((_reference: string, work: () => Promise<unknown>) => work()) };
  const job = new ReconciliationJob(
    repository as unknown as PaymentRepository,
    commands as unknown as CommandBus,
    saga as unknown as PaymentSaga,
    execution as unknown as PaymentExecution,
  );
  return { payment, repository, commands, saga, execution, job };
}

describe('ReconciliationJob', () => {
  it('recovers a creation committed before its saga started', async () => {
    const { job, repository, saga, commands, payment } = fixture();
    await job.reconcile();
    expect(repository.findStuck.mock.calls[0][0]).toContain(PaymentStatus.Pending);
    expect(saga.run).toHaveBeenCalledWith(payment.reference);
    expect(commands.execute).not.toHaveBeenCalled();
    expect(repository.recordRecoveryAttempt).toHaveBeenCalledWith(
      payment.reference,
      'unresolved: Pending',
    );
  });

  it('records a failed attempt and continues with the remaining candidates', async () => {
    const { job, repository, saga, payment } = fixture();
    repository.findStuck.mockResolvedValue([payment, aPayment()]);
    saga.run.mockRejectedValueOnce(new Error('database unavailable'));
    await job.reconcile();
    expect(repository.recordRecoveryAttempt).toHaveBeenNthCalledWith(
      1,
      payment.reference,
      'database unavailable',
    );
    expect(saga.run).toHaveBeenCalledTimes(2);
  });

  it('retries compensation without restarting the debit', async () => {
    const payment = aDebitedPayment();
    payment.markCompensationPending(FailureReason.CREDIT_FAILED);
    const { job, saga, commands } = fixture(payment);
    await job.reconcile();
    expect(saga.run).not.toHaveBeenCalled();
    expect(commands.execute).toHaveBeenCalled();
  });

  it('ignores a candidate that became terminal before the lock was acquired', async () => {
    const payment = aDebitedPayment();
    payment.approve(CREDIT);
    const { job, saga, commands, repository } = fixture(payment);
    await job.reconcile();
    expect(saga.run).not.toHaveBeenCalled();
    expect(commands.execute).not.toHaveBeenCalled();
    expect(repository.recordRecoveryAttempt).not.toHaveBeenCalled();
  });

  it('does not count an attempt owned by another worker', async () => {
    const { job, execution, repository } = fixture();
    execution.run.mockRejectedValue(new ConcurrentPaymentError('pay_x'));
    await job.reconcile();
    expect(repository.recordRecoveryAttempt).not.toHaveBeenCalled();
  });
});
