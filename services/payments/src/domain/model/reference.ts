/**
 * A business reference: a family prefix and a time-ordered body.
 *
 * The domain owns this type so that a wallet reference and a payment reference
 * cannot be swapped by accident, and so no layer below has to agree on a string
 * format. Generation lives here too — a reference is a domain concept, not a
 * persistence detail.
 */
export type ReferencePrefixName = 'usr' | 'wlt' | 'pay' | 'trx';

/** Crockford base32, lowercased, minus the ambiguous i, l, o and u. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const BODY = `[${ALPHABET}]{${TIME_LENGTH + RANDOM_LENGTH}}`;

export class Reference {
  private constructor(
    private readonly _prefix: ReferencePrefixName,
    private readonly _value: string,
  ) {}

  static of(prefix: ReferencePrefixName, value: string): Reference {
    if (!new RegExp(`^${prefix}_${BODY}$`).test(value)) {
      throw new MalformedReferenceError(prefix, value);
    }
    return new Reference(prefix, value);
  }

  /**
   * Time-prefixed body, so references sort chronologically in an index.
   * `random` is injected rather than read from a global, which keeps the domain
   * free of platform APIs and makes generation deterministic under test.
   */
  static generate(
    prefix: ReferencePrefixName,
    now: number = Date.now(),
    random: () => number = Math.random,
  ): Reference {
    let time = '';
    let rest = now;
    for (let index = 0; index < TIME_LENGTH; index++) {
      time = ALPHABET[rest % 32] + time;
      rest = Math.floor(rest / 32);
    }

    let body = '';
    for (let index = 0; index < RANDOM_LENGTH; index++) {
      body += ALPHABET[Math.floor(random() * 32) % 32];
    }
    return new Reference(prefix, `${prefix}_${time}${body}`);
  }

  get value(): string {
    return this._value;
  }

  get prefix(): ReferencePrefixName {
    return this._prefix;
  }

  equals(other: Reference): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}

export class MalformedReferenceError extends Error {
  constructor(prefix: string, value: string) {
    super(`"${value}" is not a valid ${prefix}_ reference`);
    this.name = 'MalformedReferenceError';
  }
}
