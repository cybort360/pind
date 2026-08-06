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

  it('disables TLS for credential-less localhost connection strings', () => {
    expect(resolveSsl('postgres://localhost:5432/pind')).toBe(false);
  });

  it('disables TLS for credential-less 127.0.0.1 connection strings', () => {
    expect(resolveSsl('postgres://127.0.0.1/pind')).toBe(false);
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

  it('uses the last "@" as the userinfo/host boundary, not a "@localhost" substring in userinfo', () => {
    expect(resolveSsl('postgres://user:pass@localhost:1@evil.com:5432/db')).toEqual({ rejectUnauthorized: true });
  });

  it('defaults to verifying when the connection string is not a parseable URL', () => {
    expect(resolveSsl('host=localhost port=5432 dbname=pind')).toEqual({ rejectUnauthorized: true });
  });

  it('disables TLS for uppercase LOCALHOST (postgres: is a non-special scheme, so the URL parser does not lowercase the host)', () => {
    expect(resolveSsl('postgres://LOCALHOST:5432/pind')).toBe(false);
  });

  it('disables TLS for mixed-case host variants', () => {
    expect(resolveSsl('postgres://LocalHost/pind')).toBe(false);
  });

  it('disables TLS for a unix-domain socket DSN with an empty hostname', () => {
    expect(resolveSsl('postgresql:///pind?host=/var/run/postgresql')).toBe(false);
  });
});
