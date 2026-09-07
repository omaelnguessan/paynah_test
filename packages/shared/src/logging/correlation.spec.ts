import { CORRELATION_ID_HEADER } from '../constants';
import { correlationIdOf, isSafeCorrelationId } from './correlation';

const MINTED = 'minted-id';
const mint = () => MINTED;
const carrying = (value: unknown) =>
  ({ headers: { [CORRELATION_ID_HEADER]: value } }) as never;

describe('correlationIdOf', () => {
  it('keeps an id the caller sent', () => {
    expect(correlationIdOf(carrying('order-42:leg-1'), mint)).toBe('order-42:leg-1');
  });

  it('mints one when the caller sent none', () => {
    expect(correlationIdOf({ headers: {} }, mint)).toBe(MINTED);
    expect(correlationIdOf(carrying(''), mint)).toBe(MINTED);
  });

  it('takes the first value when a header is repeated', () => {
    expect(correlationIdOf(carrying(['first', 'second']), mint)).toBe('first');
  });

  it.each([
    ['a header split', 'abc\r\nx-injected: true'],
    ['a newline', 'abc\ndef'],
    ['a space', 'abc def'],
    ['a quote', 'abc"def'],
    ['a script tag', '<script>alert(1)</script>'],
    ['an unbounded value', 'a'.repeat(129)],
  ])('refuses %s and mints instead', (_label, value) => {
    // The id is echoed in a response header, forwarded upstream and written to
    // every log line: it is repaired by replacement, never by sanitising.
    expect(correlationIdOf(carrying(value), mint)).toBe(MINTED);
  });

  it('accepts the ids the platform itself produces', () => {
    expect(isSafeCorrelationId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isSafeCorrelationId('pay_01hq3m8x0000zt7k9d2v4bqf1c:refund')).toBe(true);
  });
});
