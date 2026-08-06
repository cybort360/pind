// `pg` is CommonJS and assigns its exports dynamically, so Node's ESM loader
// cannot statically detect named exports. Import the default and destructure.
import pg from 'pg';

const { Pool } = pg;

export const MISSING_DATABASE_URL = [
  'Pind requires a PostgreSQL database.',
  '  On Replit: open the Database tool and click Create.',
  '  Locally:   createdb pind && export DATABASE_URL=postgres://localhost:5432/pind',
].join('\n');

/** Validates the connection string, throwing an actionable setup message. */
export function requireDatabaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(MISSING_DATABASE_URL);
  return trimmed;
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = requireDatabaseUrl(process.env.DATABASE_URL);
  pool = new Pool({ connectionString, ssl: resolveSsl(connectionString), max: 5 });
  return pool;
}

/**
 * Local sockets run without TLS. Everything else verifies the server
 * certificate by default. Some managed providers present a chain Node cannot
 * verify; those deployments must opt out explicitly via
 * DATABASE_SSL_NO_VERIFY=true rather than us disabling verification for
 * everyone, which would expose every deployment to MITM.
 */
export function resolveSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) return false;
  if (process.env.DATABASE_SSL_NO_VERIFY === 'true') {
    console.warn('DATABASE_SSL_NO_VERIFY=true — TLS certificate verification is disabled for Postgres.');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}
