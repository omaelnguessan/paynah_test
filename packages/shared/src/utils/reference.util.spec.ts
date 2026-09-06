import { REFERENCE_REGEX, referencePattern } from '../constants';
import { ReferencePrefix } from '../enums';
import { generateReference, isReferenceOf } from './reference.util';

describe('generateReference', () => {
  it('produces a reference matching the platform format', () => {
    const reference = generateReference(ReferencePrefix.PAYMENT);
    expect(reference).toMatch(REFERENCE_REGEX);
    expect(reference).toMatch(referencePattern(ReferencePrefix.PAYMENT));
    expect(isReferenceOf(reference, ReferencePrefix.PAYMENT)).toBe(true);
    expect(isReferenceOf(reference, ReferencePrefix.WALLET)).toBe(false);
  });

  it('never uses the ambiguous letters i, l, o and u', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateReference(ReferencePrefix.USER).slice(4)).not.toMatch(/[ilou]/);
    }
  });

  it('sorts chronologically, since the body is time-prefixed', () => {
    const earlier = generateReference(ReferencePrefix.TRANSACTION, 1_700_000_000_000);
    const later = generateReference(ReferencePrefix.TRANSACTION, 1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it('is collision-free across a burst within the same millisecond', () => {
    const now = Date.now();
    const references = new Set(
      Array.from({ length: 5000 }, () => generateReference(ReferencePrefix.WALLET, now)),
    );
    expect(references.size).toBe(5000);
  });
});
