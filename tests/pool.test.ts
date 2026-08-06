import { afterEach, describe, expect, it } from 'vitest';
import { requireDatabaseUrl, resolveSsl } from '../server/db/pool';

afterEach(() => { delete process.env.DATABASE_SSL_NO_VERIFY; });

describe('requireDatabaseUrl', () => {
  it('returns the configured connection string', () => {
    expect(requireDatabaseUrl('postgres://localhost:5432/pind')).toBe('postgres://localhost:5432/pind');
  });

  it('throws a setup message naming both Replit and local recovery', () => {
    expect(() => requireDatabaseUrl(undefined)).toThrowError(/Replit: open the Database tool/);
    expect(() => requireDatabaseUrl('   ')).toThrowError(/createdb pind/);
  });
});

describe('resolveSsl', () => {
  it('disables TLS only for local sockets', () => {
    expect(resolveSsl('postgres://user@localhost:5432/pind')).toBe(false);
    expect(resolveSsl('postgres://user@127.0.0.1:5432/pind')).toBe(false);
  });

  it('verifies certificates for remote databases by default', () => {
    expect(resolveSsl('postgres://user:pw@db.example.com:5432/pind')).toEqual({ rejectUnauthorized: true });
  });

  it('only skips verification behind an explicit opt-out', () => {
    process.env.DATABASE_SSL_NO_VERIFY = 'true';
    expect(resolveSsl('postgres://user:pw@db.example.com:5432/pind')).toEqual({ rejectUnauthorized: false });
  });

  it('does not treat a remote host containing "localhost" as local', () => {
    expect(resolveSsl('postgres://user:pw@localhost.evil.com:5432/pind')).toEqual({ rejectUnauthorized: true });
  });
});
