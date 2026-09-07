/**
 * Values that are fine on a laptop and unacceptable in production. The list is
 * deliberately about *placeholders*, not about strength: a short secret is
 * caught by the length rule, but a long one copied from `.env.example` would
 * sail through it — and that is the mistake that actually happens.
 */
const PLACEHOLDERS = ['change-me', 'changeme', 'dev-internal', 'test-internal', 'example', 'paynad_pwd'];

export interface ProductionSecrets {
  NODE_ENV: string;
  INTERNAL_API_KEY?: string;
  INTERNAL_API_SECRET?: string;
  DB_PASSWORD?: string;
  RABBITMQ_URL?: string;
}

/**
 * Refuses to boot a production container on the repository's own credentials.
 * The check runs at startup, where a wrong answer costs a failed deploy — not
 * at the first request, where it would cost an incident.
 */
export function assertNoPlaceholderSecrets(env: ProductionSecrets): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const offenders = (['INTERNAL_API_KEY', 'INTERNAL_API_SECRET', 'DB_PASSWORD'] as const)
    .filter((name) => {
      const value = (env[name] ?? '').toLowerCase();
      return value.length > 0 && PLACEHOLDERS.some((marker) => value.includes(marker));
    });

  if (offenders.length > 0) {
    throw new Error(
      `Refusing to start in production with development credentials: ${offenders.join(', ')}. ` +
        'Generate real values, for instance with `openssl rand -hex 24`.',
    );
  }
}
