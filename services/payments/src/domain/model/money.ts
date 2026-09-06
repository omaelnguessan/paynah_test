/** The currencies the platform settles in. */
export enum Currency {
  XOF = 'XOF',
}

/**
 * An amount and its currency, inseparable.
 *
 * Amounts are integers in the minor unit and never floats: the value object
 * refuses anything else at construction, so no other layer has to re-check it.
 * Two amounts of different currencies cannot be compared or combined.
 */
export class Money {
  private constructor(
    private readonly _amount: number,
    private readonly _currency: Currency,
  ) {}

  static of(amount: number, currency: Currency): Money {
    if (!Number.isInteger(amount)) {
      throw new InvalidMoneyError(`amount must be an integer, got ${amount}`);
    }
    if (amount < Money.MINIMUM) {
      throw new InvalidMoneyError(`amount must be at least ${Money.MINIMUM}, got ${amount}`);
    }
    if (amount % Money.STEP !== 0) {
      throw new InvalidMoneyError(`amount must be a multiple of ${Money.STEP}, got ${amount}`);
    }
    return new Money(amount, currency);
  }

  static readonly MINIMUM = 5;
  static readonly STEP = 5;

  get amount(): number {
    return this._amount;
  }

  get currency(): Currency {
    return this._currency;
  }

  equals(other: Money): boolean {
    return this._amount === other._amount && this._currency === other._currency;
  }

  toString(): string {
    return `${this._amount} ${this._currency}`;
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}
