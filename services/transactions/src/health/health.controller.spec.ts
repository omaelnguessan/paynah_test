import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const query = jest.fn();

  async function controllerWith(): Promise<HealthController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: getDataSourceToken(), useValue: { query } as Partial<DataSource> }],
    }).compile();
    return moduleRef.get(HealthController);
  }

  beforeEach(() => query.mockReset());

  it('reports Healthy while the database answers', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    const result = await (await controllerWith()).check();

    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(result).toMatchObject({ service: 'transactions', status: 'Healthy', database: 'up' });
    expect(result.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('degrades instead of throwing when the database is unreachable', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await (await controllerWith()).check();

    expect(result).toMatchObject({ status: 'Degraded', database: 'down' });
  });
});
