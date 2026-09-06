import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/**
 * Carries the correlation id for the length of a request, so every log line and
 * every outbound call can quote it without threading it through each signature.
 * One `grep` on that id then follows a payment across the three services.
 */
@Injectable()
export class CorrelationContext {
  private readonly storage = new AsyncLocalStorage<string>();

  run<T>(correlationId: string, work: () => T): T {
    return this.storage.run(correlationId, work);
  }

  get current(): string {
    return this.storage.getStore() ?? randomUUID();
  }
}
