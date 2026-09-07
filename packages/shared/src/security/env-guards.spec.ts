import { assertNoPlaceholderSecrets } from './env-guards';

const REAL = {
  INTERNAL_API_KEY: 'b41f9c2a7d63e0158a4c9f2b',
  INTERNAL_API_SECRET: '9e2c4a1f8b73d05a6c1e4f9b2d8a7c30',
  DB_PASSWORD: 'S3n7iN3l-p0stgres',
};

describe('assertNoPlaceholderSecrets', () => {
  it('lets development run on the repository defaults', () => {
    expect(() =>
      assertNoPlaceholderSecrets({
        NODE_ENV: 'development',
        INTERNAL_API_KEY: 'dev-internal-key-change-me',
        INTERNAL_API_SECRET: 'dev-internal-secret-change-me-0123456789',
        DB_PASSWORD: 'accounts_pwd',
      }),
    ).not.toThrow();
  });

  it('refuses to boot production on a credential nobody replaced', () => {
    expect(() =>
      assertNoPlaceholderSecrets({
        NODE_ENV: 'production',
        ...REAL,
        INTERNAL_API_SECRET: 'dev-internal-secret-change-me-0123456789',
      }),
    ).toThrow(/INTERNAL_API_SECRET/);
  });

  it('names every offender at once, not the first one', () => {
    const failing = () =>
      assertNoPlaceholderSecrets({
        NODE_ENV: 'production',
        INTERNAL_API_KEY: 'dev-internal-key-change-me',
        INTERNAL_API_SECRET: 'changeme-but-long-enough-to-pass-length',
        DB_PASSWORD: REAL.DB_PASSWORD,
      });

    expect(failing).toThrow(/INTERNAL_API_KEY/);
    expect(failing).toThrow(/INTERNAL_API_SECRET/);
  });

  it('says nothing when production carries real credentials', () => {
    expect(() => assertNoPlaceholderSecrets({ NODE_ENV: 'production', ...REAL })).not.toThrow();
  });

  it('is length-blind on purpose: a long placeholder is still a placeholder', () => {
    // The length rules live in the env schema; this one is about origin.
    expect(() =>
      assertNoPlaceholderSecrets({
        NODE_ENV: 'production',
        ...REAL,
        DB_PASSWORD: 'paynad_pwd_but_padded_out_to_look_serious',
      }),
    ).toThrow(/DB_PASSWORD/);
  });
});
