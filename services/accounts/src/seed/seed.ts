import { Logger } from '@nestjs/common';
import {
  Currency,
  ReferencePrefix,
  TransactionType,
  WalletStatus,
  generateReference,
} from '@paynad/shared';
import { EntityManager } from 'typeorm';
import { LedgerEntry } from '../wallets/entities/ledger-entry.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { User } from '../users/entities/user.entity';
import dataSource from '../config/data-source';

const logger = new Logger('seed:accounts');

/**
 * Three users and five wallets, with deliberately varied balances: one rich,
 * one empty, one modest, one merchant account and one frozen — between them
 * they cover every path the API can take without a single hand-written row.
 *
 * Fixtures are keyed on natural keys (the customer email, the wallet label) so
 * re-running the seed never duplicates a row and never re-credits a wallet.
 */
const FIXTURES = [
  {
    email: 'awa.traore@example.com',
    firstname: 'Awa',
    lastname: 'Traoré',
    phone: '+2250700000001',
    city: 'Abidjan',
    country: 'CI',
    wallets: [
      { label: 'Compte principal', balance: 500_000, status: WalletStatus.ACTIVE },
      { label: 'Compte épargne', balance: 0, status: WalletStatus.ACTIVE },
    ],
  },
  {
    email: 'kofi.mensah@example.com',
    firstname: 'Kofi',
    lastname: 'Mensah',
    phone: '+2250700000002',
    city: 'Bouaké',
    country: 'CI',
    wallets: [
      { label: 'Compte principal', balance: 25_000, status: WalletStatus.ACTIVE },
      // The destination of the demo payment: funded, but not richly.
      { label: 'Compte marchand', balance: 75_000, status: WalletStatus.ACTIVE },
    ],
  },
  {
    email: 'salif.diallo@example.com',
    firstname: 'Salif',
    lastname: 'Diallo',
    phone: '+2260700000003',
    city: 'Ouagadougou',
    country: 'BF',
    // Kept frozen on purpose: it is the fixture for the WALLET_FROZEN path.
    wallets: [{ label: 'Compte bloqué', balance: 10_000, status: WalletStatus.FROZEN }],
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
  for (const fixture of FIXTURES) {
    const user = await upsertUser(manager, fixture);
    for (const wallet of fixture.wallets) {
      await upsertWallet(manager, user, wallet);
    }
  }
}

async function upsertUser(
  manager: EntityManager,
  fixture: (typeof FIXTURES)[number],
): Promise<User> {
  const users = manager.getRepository(User);
  const existing = await users.findOne({ where: { customer_email: fixture.email } });
  if (existing) {
    logger.log(`user ${fixture.email} already present as ${existing.reference}`);
    return existing;
  }

  const created = await users.save(
    users.create({
      reference: generateReference(ReferencePrefix.USER),
      customer_firstname: fixture.firstname,
      customer_lastname: fixture.lastname,
      customer_email: fixture.email,
      customer_phone_number: fixture.phone,
      customer_address: null,
      customer_city: fixture.city,
      customer_country: fixture.country,
      customer_zip_code: null,
    }),
  );
  logger.log(`created user ${created.reference} (${fixture.email})`);
  return created;
}

async function upsertWallet(
  manager: EntityManager,
  user: User,
  fixture: { label: string; balance: number; status: WalletStatus },
): Promise<void> {
  const wallets = manager.getRepository(Wallet);
  const existing = await wallets.findOne({ where: { user_id: user.id, label: fixture.label } });
  if (existing) {
    logger.log(`wallet "${fixture.label}" already present as ${existing.reference}`);
    return;
  }

  const reference = generateReference(ReferencePrefix.WALLET);
  const created = await wallets.save(
    wallets.create({
      reference,
      user_id: user.id,
      currency: Currency.XOF,
      balance: fixture.balance,
      reserved_amount: 0,
      label: fixture.label,
      status: fixture.status,
    }),
  );

  // Same rule as the API: an opening balance is a movement, so it gets a row.
  if (fixture.balance > 0) {
    const ledger = manager.getRepository(LedgerEntry);
    await ledger.save(
      ledger.create({
        reference: generateReference(ReferencePrefix.TRANSACTION),
        wallet_id: created.id,
        transaction_id: `opening-${reference.replace('_', '-')}`,
        type: TransactionType.CREDIT,
        amount: fixture.balance,
        currency: Currency.XOF,
        balance_before: 0,
        balance_after: fixture.balance,
        description: 'Opening balance',
        payment_reference: null,
      }),
    );
  }
  logger.log(`created wallet ${created.reference} "${fixture.label}" (${fixture.status})`);
}

seed().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
