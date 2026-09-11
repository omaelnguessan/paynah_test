export enum IdempotencyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  paymentReference: string | null;
  responseBody: Record<string, unknown> | null;
}

export interface IdempotencyRepository {
  /**
   * Claims the key by inserting it. Returns false when the unique constraint
   * fires — the caller then reads the existing record and decides.
   * Never a read-then-write: two concurrent requests must not both claim.
   */
  claim(key: string, requestHash: string): Promise<boolean>;
  find(key: string): Promise<IdempotencyRecord | null>;
  complete(
    key: string,
    paymentReference: string,
    responseBody: Record<string, unknown>,
  ): Promise<void>;
}

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');
