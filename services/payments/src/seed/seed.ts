import { Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import dataSource from '../infrastructure/config/data-source';
import { PaymentOrmEntity } from '../infrastructure/persistence/entities/payment.orm-entity';
import { Currency, Money } from '../domain/model/money';
import { FailureReason } from '../domain/model/payment-status';
import { Payment } from '../domain/model/payment';
import { Reference } from '../domain/model/reference';
import { PaymentOrmMapper } from '../infrastructure/persistence/mappers/payment.orm-mapper';

const logger = new Logger('seed:payments');

const SOURCE = Reference.of('wlt', 'wlt_01hq3m8x0000zt7k9d2v4bqf1c');
const DESTINATION = Reference.of('wlt', 'wlt_01hq3m8x0000zt7k9d2v4bqf9z');
const DEBIT = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqf1c');
const CREDIT = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqf9z');
const REFUND = Reference.of('trx', 'trx_01hq3m8x0000zt7k9d2v4bqfaa');

/** Seeds each terminal state through the aggregate. Deduplicated by transaction_id. */
const FIXTURES: Array<{ transactionId: string; build: () => Payment }> = [
  {
    transactionId: 'seed-payment-approved-01',
    build: () => {
      const payment = newPayment('seed-payment-approved-01', 25_000);
      payment.markProcessing();
      payment.markDebited(DEBIT);
      payment.approve(CREDIT);
      return payment;
    },
  },
  {
    transactionId: 'seed-payment-declined-01',
    build: () => {
      const payment = newPayment('seed-payment-declined-01', 900_000);
      payment.decline(FailureReason.INSUFFICIENT_BALANCE);
      return payment;
    },
  },
  {
    transactionId: 'seed-payment-compensated-01',
    build: () => {
      const payment = newPayment('seed-payment-compensated-01', 5_000);
      payment.markProcessing();
      payment.markDebited(DEBIT);
      payment.compensate(REFUND);
      return payment;
    },
  },
];

function newPayment(transactionId: string, amount: number): Payment {
  return Payment.initiate({
    transactionId,
    money: Money.of(amount, Currency.XOF),
    source: SOURCE,
    destination: DESTINATION,
    description: 'Paiement de demonstration',
    metadata: null,
  });
}

async function seed(): Promise<void> {
  await dataSource.initialize();
  try {
    if (await dataSource.showMigrations()) {
      throw new Error('Pending migrations — run `make migrate` before seeding.');
    }
    await dataSource.transaction(seedFixtures);
    logger.log('seed completed');
  } finally {
    await dataSource.destroy();
  }
}

async function seedFixtures(manager: EntityManager): Promise<void> {
  const payments = manager.getRepository(PaymentOrmEntity);

  for (const fixture of FIXTURES) {
    const existing = await payments.findOne({
      where: { transaction_id: fixture.transactionId },
    });
    if (existing) {
      logger.log(`${fixture.transactionId} already present as ${existing.reference}`);
      continue;
    }

    const payment = fixture.build();
    // The events are pulled and dropped: a seed replays history, it does not
    // announce it, and nothing downstream should react to a fixture.
    payment.pullEvents();

    await payments.save(payments.create(PaymentOrmMapper.toPersistence(payment)));
    logger.log(`created ${payment.reference.value} (${payment.status})`);
  }
}

seed().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
