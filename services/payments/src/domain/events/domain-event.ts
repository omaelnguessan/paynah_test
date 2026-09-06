/**
 * Something that happened, past tense, expressed in the domain's own words.
 * Accumulated inside the aggregate and published only once the transaction
 * that produced it has committed.
 */
export abstract class DomainEvent {
  readonly occurredAt: Date;

  protected constructor(
    readonly aggregateReference: string,
    readonly type: string,
    occurredAt: Date = new Date(),
  ) {
    this.occurredAt = occurredAt;
  }

  /** Flat, snake_case payload — the shape that travels on the wire. */
  abstract payload(): Record<string, unknown>;
}
