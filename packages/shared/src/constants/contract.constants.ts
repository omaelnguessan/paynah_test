/** Smallest indivisible amount accepted, in the currency's minor unit. */
export const AMOUNT_MIN = 5;

/** Every amount must be a multiple of this step. */
export const AMOUNT_STEP = 5;

/** Upper bound guarding against overflow of a 64-bit ledger balance. */
export const AMOUNT_MAX = 1_000_000_000_000;

/**
 * Description whitelist: letters (incl. accented), digits, space and a short
 * punctuation set. Deliberately excludes `# / $ _ &`.
 */
export const SAFE_DESCRIPTION_REGEX = /^[\p{L}\p{N} .,:;!?'"()\-+@]*$/u;

export const DESCRIPTION_MAX_LENGTH = 255;

/** `<prefix>_<26 lowercase base32 chars>` — a ULID body keeps references sortable. */
export const REFERENCE_BODY_LENGTH = 26;

/** Crockford base32 body, lowercased and minus the ambiguous i, l, o, u. */
export const REFERENCE_BODY_PATTERN = '[0-9a-hjkmnp-tv-z]{26}';

export const REFERENCE_REGEX = new RegExp(`^[a-z]{3}_${REFERENCE_BODY_PATTERN}$`);

export function referencePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_${REFERENCE_BODY_PATTERN}$`);
}

/** Caller-supplied idempotency key. Allows _ and : for derived saga movement keys. */
export const TRANSACTION_ID_MIN_LENGTH = 8;
export const TRANSACTION_ID_MAX_LENGTH = 64;
export const TRANSACTION_ID_REGEX = /^[A-Za-z0-9:_-]{8,64}$/;

/** Header carrying a per-request correlation id across the three services. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';
