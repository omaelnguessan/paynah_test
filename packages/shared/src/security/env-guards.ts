/** Known development-secret placeholders, rejected in production. */
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
