import { Logger } from '@nestjs/common';
import {
  Currency,
  ReferencePrefix,
  TransactionStatus,
  TransactionType,
  generateReference,
} from '@paynad/shared';
import { EntityManager } from 'typeorm';
import dataSource from '../config/data-source';
import { Transaction } from '../transactions/entities/transaction.entity';

const logger = new Logger('seed:transactions');

/** Demo debit, refund and credit, deduplicated by transaction_id. */
const PAYMENT_REFERENCE = 'pay_01hq3m8x0000zt7k9d2v4bqf1c';
const USER_REFERENCE = 'usr_01hq3m8x0000zt7k9d2v4bqf1c';
const WALLET_REFERENCE = 'wlt_01hq3m8x0000zt7k9d2v4bqf1c';

const FIXTURES = [
  {
    transaction_id: 'seed-movement-000001',
    type: TransactionType.DEBIT,
    amount: 15_000,
    description: 'Paiement facture avril',
    occurred_at: '2026-09-01T09:30:00.000Z',
  },
  {
    transaction_id: 'seed-movement-000002',
    type: TransactionType.REFUND,
    amount: 15_000,
    description: 'Remboursement facture avril',
    occurred_at: '2026-09-02T14:05:00.000Z',
  },
  {
    transaction_id: 'seed-movement-000003',
    type: TransactionType.CREDIT,
    amount: 40_000,
    description: 'Virement entrant',
    occurred_at: '2026-09-03T08:00:00.000Z',
  },
];

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
  const transactions = manager.getRepository(Transaction);

  for (const fixture of FIXTURES) {
    const existing = await transactions.findOne({
      where: { transaction_id: fixture.transaction_id },
    });
    if (existing) {
      logger.log(`${fixture.transaction_id} already recorded as ${existing.reference}`);
      continue;
    }

    const created = await transactions.save(
      transactions.create({
        reference: generateReference(ReferencePrefix.TRANSACTION),
        transaction_id: fixture.transaction_id,
        payment_reference: PAYMENT_REFERENCE,
        type: fixture.type,
        wallet_reference: WALLET_REFERENCE,
        user_reference: USER_REFERENCE,
        amount: fixture.amount,
        currency: Currency.XOF,
        description: fixture.description,
        status: TransactionStatus.APPROVED,
        occurred_at: new Date(fixture.occurred_at),
      }),
    );
    logger.log(`recorded ${created.reference} (${fixture.type} ${fixture.amount})`);
  }
}

seed().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
