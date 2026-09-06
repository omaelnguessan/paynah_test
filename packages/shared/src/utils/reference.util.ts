import { randomBytes } from 'crypto';
import { ReferencePrefix } from '../enums';
import { REFERENCE_BODY_LENGTH } from '../constants';

/** Crockford base32, lowercased, minus the ambiguous i, l, o and u. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = REFERENCE_BODY_LENGTH - TIME_LENGTH;

function encodeTime(now: number): string {
  let out = '';
  let rest = now;
  for (let i = TIME_LENGTH - 1; i >= 0; i--) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LENGTH);
  let out = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    out += ALPHABET[bytes[i] % 32];
  }
  return out;
}

/**
 * Builds a server-side business reference, e.g. `pay_01hq3m8x0000zt7k9d2v4bqf1c`.
 * Time-prefixed so references sort chronologically in an index.
 */
export function generateReference(prefix: ReferencePrefix, now: number = Date.now()): string {
  return `${prefix}_${encodeTime(now)}${encodeRandom()}`;
}

export function isReferenceOf(value: string, prefix: ReferencePrefix): boolean {
  return value.startsWith(`${prefix}_`);
}
