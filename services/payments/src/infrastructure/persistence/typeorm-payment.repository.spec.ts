import { TypeOrmPaymentRepository } from './typeorm-payment.repository';
import { TransactionContext } from './transaction-context';
import { PaymentOrmMapper } from './mappers/payment.orm-mapper';
import { ConcurrentPaymentError } from '../../domain/errors/concurrent-payment.error';
import { aPayment } from '../../testing/doubles';

describe('optimistic payment persistence', () => {
  it('rejects a stale aggregate instead of overwriting a newer state', async () => {
    const original = aPayment();
    const row = {
      ...PaymentOrmMapper.toPersistence(original),
      version: 1,
      created_at: original.createdAt,
      updated_at: original.updatedAt,
    };
    let databaseVersion = 1;
    let expectedVersion = 0;
    const query: Record<string, jest.Mock> = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn((_sql, parameters) => {
        expectedVersion = parameters.version;
        return query;
      }),
      execute: jest.fn(async () => ({
        affected: expectedVersion === databaseVersion ? (databaseVersion++, 1) : 0,
      })),
    };
    const repository = new TypeOrmPaymentRepository({
      manager: {
        getRepository: () => ({
          findOne: async () => row,
          createQueryBuilder: () => query,
        }),
      },
    } as unknown as TransactionContext);
    const first = (await repository.findByReference(original.reference))!;
    const stale = (await repository.findByReference(original.reference))!;
    first.markProcessing();
    await repository.save(first);
    stale.markProcessing();
    await expect(repository.save(stale)).rejects.toBeInstanceOf(ConcurrentPaymentError);
    expect(databaseVersion).toBe(2);
    expect(query.where).toHaveBeenCalledWith('reference = :reference AND version = :version', {
      reference: original.reference.value,
      version: 1,
    });
  });
});
