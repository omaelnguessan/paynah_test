import { MalformedReferenceError, Reference } from './reference';

describe('Reference', () => {
  it('generates a well-formed reference for its family', () => {
    const reference = Reference.generate('pay');

    expect(reference.value).toMatch(/^pay_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(reference.prefix).toBe('pay');
  });

  it('never uses the ambiguous letters i, l, o and u', () => {
    for (let index = 0; index < 200; index++) {
      expect(Reference.generate('trx').value.slice(4)).not.toMatch(/[ilou]/);
    }
  });

  it('sorts chronologically, since the body is time-prefixed', () => {
    const earlier = Reference.generate('pay', 1_700_000_000_000);
    const later = Reference.generate('pay', 1_700_000_001_000);

    expect(earlier.value < later.value).toBe(true);
  });

  it('is collision-free across a burst within the same millisecond', () => {
    const now = Date.now();
    const values = new Set(
      Array.from({ length: 5000 }, () => Reference.generate('pay', now).value),
    );
    expect(values.size).toBe(5000);
  });

  it('is deterministic when the randomness is injected', () => {
    const fixed = () => 0.5;
    expect(Reference.generate('pay', 1_700_000_000_000, fixed).value).toBe(
      Reference.generate('pay', 1_700_000_000_000, fixed).value,
    );
  });

  it('refuses a reference of the wrong family', () => {
    const wallet = Reference.generate('wlt').value;
    expect(() => Reference.of('pay', wallet)).toThrow(MalformedReferenceError);
  });

  it.each(['', 'pay_', 'pay_short', 'nope', 'pay_01hq3m8x0000zt7k9d2v4bqf1i'])(
    'refuses %p',
    (value) => {
      expect(() => Reference.of('pay', value)).toThrow(MalformedReferenceError);
    },
  );

  it('compares by value', () => {
    const value = Reference.generate('wlt').value;
    expect(Reference.of('wlt', value).equals(Reference.of('wlt', value))).toBe(true);
    expect(Reference.of('wlt', value).equals(Reference.generate('wlt'))).toBe(false);
  });
});
