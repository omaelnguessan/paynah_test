/** Base domain error. HTTP mapping belongs to the presentation layer. */
export abstract class DomainError extends Error {
  protected constructor(
    message: string,
    /** Stable, machine-readable discriminator. */
    readonly code: string,
    /** Extra context for the caller; never an internal detail. */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}
