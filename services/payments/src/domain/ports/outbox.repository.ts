export interface OutboxMessage {
  aggregateReference: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
}

/**
 * The transactional outbox. Writing a message here in the same transaction as
 * the state change is what makes publication at-least-once without tying the
 * payment's latency to the broker being up.
 */
export interface OutboxRepository {
  enqueue(messages: readonly OutboxMessage[]): Promise<void>;
}

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');
