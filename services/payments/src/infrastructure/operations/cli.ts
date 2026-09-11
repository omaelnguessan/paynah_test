import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../config/data-source';
import { PaymentOperations } from './payment-operations';

async function main(): Promise<void> {
  const [command, id] = process.argv.slice(2);
  if (command !== 'metrics' && !(command === 'retry-outbox' && id)) {
    throw new Error('Usage: pnpm ops metrics | pnpm ops retry-outbox <uuid>');
  }
  const database = await new DataSource(dataSourceOptions).initialize();
  try {
    const operations = new PaymentOperations(database);
    if (command === 'metrics') console.log(JSON.stringify(await operations.metrics(), null, 2));
    else {
      const retried = await operations.retryOutbox(id);
      console.log(JSON.stringify({ outbox_id: id, retried }));
      if (!retried) process.exitCode = 1;
    }
  } finally {
    await database.destroy();
  }
}
void main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
