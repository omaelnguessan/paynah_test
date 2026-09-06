import { isValidAmount } from './amount.util';

describe('isValidAmount', () => {
  it.each([5, 10, 1000, 999_995])('accepts %p', (value) => {
    expect(isValidAmount(value)).toBe(true);
  });

  it.each([
    ['below the minimum', 0],
    ['negative', -5],
    ['not a multiple of 5', 7],
    ['a float', 10.5],
    ['a float that looks round', 10.000000001],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['above the ceiling', 1_000_000_000_005],
  ])('rejects %s', (_label, value) => {
    expect(isValidAmount(value)).toBe(false);
  });

  it.each([['a numeric string', '100'], ['null', null], ['undefined', undefined]])(
    'rejects %s',
    (_label, value) => {
      expect(isValidAmount(value)).toBe(false);
    },
  );
});
