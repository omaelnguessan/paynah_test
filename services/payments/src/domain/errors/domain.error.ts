/**
 * Base of every failure the domain can express.
 *
 * A domain error names a business outcome, never a transport one: no HTTP
 * status, no SQL state. The presentation layer maps these onto the wire.
 */
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
