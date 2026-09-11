import { DataSource } from 'typeorm';
import { PaymentOperations } from './payment-operations';

describe('payment operations', () => {
  const id = '8b0555f0-67a2-4fc0-a829-2184c0c9b418';
  it('requeues only exhausted, unpublished messages while retaining their identity', async () => {
    const query = jest.fn().mockResolvedValue([[{ id }], 1]);
    const operations = new PaymentOperations({ query } as unknown as DataSource);
    await expect(operations.retryOutbox(id)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('published_at IS NULL AND attempts >= $2'),
      [id, 10],
    );
    query.mockResolvedValue([[], 0]);
    await expect(operations.retryOutbox(id)).resolves.toBe(false);
  });

  it('rejects invalid message identifiers before querying the database', async () => {
    const query = jest.fn();
    await expect(
      new PaymentOperations({ query } as unknown as DataSource).retryOutbox('invalid'),
    ).rejects.toThrow('UUID');
    expect(query).not.toHaveBeenCalled();
  });
});
