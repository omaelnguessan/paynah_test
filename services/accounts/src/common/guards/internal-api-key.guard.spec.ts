import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '@paynad/shared';
import { InternalApiKeyGuard } from './internal-api-key.guard';

const KEY = 'internal-key-0123456789';
const SECRET = 'internal-secret-0123456789-0123456789';

function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, method: 'POST', url: '/accounts/wlt_x/debit' }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalApiKeyGuard', () => {
  const config = {
    getOrThrow: (key: string) => (key === 'INTERNAL_API_KEY' ? KEY : SECRET),
  } as ConfigService;
  const guard = new InternalApiKeyGuard(config);

  it('lets a correctly credentialed call through', () => {
    expect(guard.canActivate(contextWith({ 'x-api-key': KEY, 'x-api-secret': SECRET }))).toBe(true);
  });

  it.each([
    ['no headers at all', {}],
    ['only the key', { 'x-api-key': KEY }],
    ['only the secret', { 'x-api-secret': SECRET }],
    ['a wrong key', { 'x-api-key': 'nope', 'x-api-secret': SECRET }],
    ['a wrong secret', { 'x-api-key': KEY, 'x-api-secret': 'nope' }],
    ['a key that is a prefix of the real one', { 'x-api-key': KEY.slice(0, -1), 'x-api-secret': SECRET }],
    ['a key with trailing padding', { 'x-api-key': `${KEY}x`, 'x-api-secret': SECRET }],
    ['a longer key sharing the prefix', { 'x-api-key': `${KEY}${KEY}`, 'x-api-secret': SECRET }],
  ])('rejects %s', (_label, headers) => {
    expect(() => guard.canActivate(contextWith(headers))).toThrow(AppException);
  });

  it('rejects with a 401 that says nothing about which half failed', () => {
    try {
      guard.canActivate(contextWith({ 'x-api-key': KEY, 'x-api-secret': 'nope' }));
      throw new Error('expected the guard to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(401);
      expect((error as AppException).payload).toBeNull();
    }
  });
});
