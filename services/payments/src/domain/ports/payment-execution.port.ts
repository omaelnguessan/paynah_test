/** Serializes the full workflow, including remote effects, across instances. */
export interface PaymentExecution {
  run<T>(reference: string, work: () => Promise<T>): Promise<T>;
}
export const PAYMENT_EXECUTION = Symbol('PAYMENT_EXECUTION');
