import { Currency, InvalidMoneyError, Money } from './money';

describe('Money', () => {
  it.each([5, 10, 5_000, 999_995])('accepts %p', (amount) => {
    expect(Money.of(amount, Currency.XOF).amount).toBe(amount);
  });

  it.each([
    ['a float', 10.5],
    ['a float that looks round', 10.000000001],
    ['zero', 0],
    ['a negative amount', -5],
    ['a value below the minimum', 3],
    ['a value off the step', 7],
    ['NaN', Number.NaN],
  ])('refuses %s', (_label, amount) => {
    expect(() => Money.of(amount, Currency.XOF)).toThrow(InvalidMoneyError);
  });

  it('compares by value, not identity', () => {
    expect(Money.of(500, Currency.XOF).equals(Money.of(500, Currency.XOF))).toBe(true);
    expect(Money.of(500, Currency.XOF).equals(Money.of(505, Currency.XOF))).toBe(false);
  });

  it('is immutable once built', () => {
    const money = Money.of(500, Currency.XOF);
    expect(Object.getOwnPropertyDescriptor(money, 'amount')).toBeUndefined();
    expect(money.amount).toBe(500);
  });
});
