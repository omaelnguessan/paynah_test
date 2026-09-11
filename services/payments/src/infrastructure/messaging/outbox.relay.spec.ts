import { EMPTY, NEVER, throwError } from 'rxjs';
import { ClientProxy } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { OutboxRelay } from './outbox.relay';

function fixture(attempts = 0) {
  const message = {
    id: 'message-id',
    aggregate_reference: 'pay_x',
    event_type: 'payment.approved',
    payload: {},
    attempts,
  };
  const update = jest.fn();
  const manager = {
    query: jest.fn().mockResolvedValueOnce([message]).mockResolvedValue([]),
    getRepository: () => ({ update }),
  };
  const database = {
    transaction: jest.fn((work: (manager: unknown) => Promise<unknown>) => work(manager)),
  };
  const client = { emit: jest.fn().mockReturnValue(EMPTY), close: jest.fn() };
  return {
    relay: new OutboxRelay(database as unknown as DataSource, client as unknown as ClientProxy),
    manager,
    update,
    client,
    database,
  };
}

describe('OutboxRelay', () => {
  it('acknowledges only after broker completion and locks the selected row', async () => {
    const { relay, manager, update, client } = fixture();
    await relay.drain();
    expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(update).toHaveBeenCalledWith(
      { id: 'message-id' },
      expect.objectContaining({ published_at: expect.any(Date) }),
    );
    expect(client.emit.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
  });

  it('records exhausted retries without marking the message published', async () => {
    const { relay, client, update } = fixture(9);
    client.emit.mockReturnValue(throwError(() => new Error('broker unavailable')));
    await relay.drain();
    expect(update).toHaveBeenCalledWith(
      { id: 'message-id' },
      {
        attempts: 10,
        last_error: 'Error: broker unavailable',
        next_attempt_at: expect.any(Date),
      },
    );
  });

  it('times out a silent broker instead of keeping the relay blocked indefinitely', async () => {
    jest.useFakeTimers();
    try {
      const { relay, client, update } = fixture();
      client.emit.mockReturnValue(NEVER);
      const draining = relay.drain();
      await jest.advanceTimersByTimeAsync(5001);
      await draining;
      expect(update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attempts: 1, last_error: expect.stringContaining('Timeout') }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
