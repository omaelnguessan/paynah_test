import { AMOUNT_MAX, AMOUNT_MIN, AMOUNT_STEP } from '../constants';

/** Amounts travel as integers in the minor unit; floats never enter the system. */
export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AMOUNT_MIN &&
    value <= AMOUNT_MAX &&
    value % AMOUNT_STEP === 0
  );
}
