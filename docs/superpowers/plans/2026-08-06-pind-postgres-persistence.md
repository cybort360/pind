# Pind PostgreSQL Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pind's single-JSONB-document storage with a relational PostgreSQL schema, forward-only migrations, and an idempotent Northstar Creative seed — without changing the HTTP API contract or any client code.

**Architecture:** Twelve tables with real foreign keys and CHECK constraints. `repository.read(workspaceId)` assembles the existing `AppState` shape from relational queries; mutation routes run targeted SQL inside real transactions and then re-read. The `writeQueue` promise chain and the JSON `FileRepository` are deleted. `DATABASE_URL` becomes mandatory.

**Tech Stack:** Node 20+, TypeScript 5.7 (ESM, `NodeNext`), Express 4, `pg` 8.13, Vitest 2.1, PostgreSQL 16. No ORM.

## Global Constraints

- **No ORM.** Use the existing `pg` client and hand-written SQL. Adding Drizzle/Prisma is out of scope.
- **No client-side changes.** Nothing under `src/` may be modified. The `AppState` JSON returned by every route must stay byte-compatible in shape.
- **`pg` is CommonJS.** Always `import pg from 'pg'` then destructure — named imports break under Node's ESM loader.
- **Server imports need explicit `.js` extensions** (tsconfig.server.json uses `NodeNext`).
- **All async Express handlers must stay wrapped in the existing `route()` helper** in `server/index.ts`. Express 4 does not forward rejections; an unwrapped rejection kills the process.
- **Timestamps:** `AppState` uses ISO-8601 strings. Postgres returns `Date` objects for `TIMESTAMPTZ`; every mapper must call `.toISOString()`.
- **Enumerations use `CHECK` constraints**, never Postgres enum types.
- **Migrations are forward-only.** No down-migrations.
- **Never disable TLS verification unconditionally.** Remote Postgres verifies certificates by default; `DATABASE_SSL_NO_VERIFY=true` is the only opt-out and must log a warning. The old `repository.ts` disabled verification for every non-local host — do not carry that forward.
- **Demo workspace id is exactly `workspace-northstar`.**
- **Seed idempotency uses `INSERT … ON CONFLICT (id) DO NOTHING`** on the existing stable natural IDs.
- Run `npm run check` (typecheck) and `npm test` before every commit.

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `server/db/pool.ts` | Single `pg.Pool`, `DATABASE_URL` requirement, fail-fast message, `closePool()` |
| `server/db/migrate.ts` | Advisory-locked forward-only migration runner |
| `server/migrations/001_initial_schema.sql` | All twelve tables, indexes, constraints |
| `server/db/rows.ts` | Row→domain mappers (`Date`→ISO strings) shared by assemble and seed |
| `server/db/assemble.ts` | `readAppState(workspaceId)`, `readReviewPayload(token)` |
| `server/db/seed.ts` | Idempotent relational seed + scoped reset |
| `tests/helpers/db.ts` | Test database bootstrap, migrate, truncate |
| `tests/migrate.test.ts` | Migration idempotency |
| `tests/repository.test.ts` | Assembly, constraints, review-payload scoping |

**Modify:**

| Path | Change |
|---|---|
| `server/repository.ts` | Rewrite: Postgres-only, `transaction()`, delete `FileRepository` |
| `server/seed-data.ts` | Add `workspaceId`, re-anchor relative dates at seed time |
| `server/index.ts` | Boot sequence, delete `updateState`/`writeQueue`, rewrite 15 routes, PG error mapping |
| `package.json` | `db:migrate`, `db:seed`, `db:reset` scripts |
| `vitest.config.ts` (create) | Register DB test setup, serial execution |
| `.env.example`, `README.md` | Document `DATABASE_URL` as required |

---

### Task 1: Repository init, connection pool, fail-fast boot

**Files:**
- Create: `.git` (via `git init`)
- Create: `server/db/pool.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `getPool(): pg.Pool`, `closePool(): Promise<void>`, `requireDatabaseUrl(): string` from `server/db/pool.ts`.

- [x] **Step 1: Initialise git so this work is tracked**

```bash
cd "$PROJECT_ROOT"
git init
git add -A
git commit -m "chore: baseline before postgres persistence work"
```

Expected: a commit containing the current working tree. `.gitignore` already excludes `node_modules`, `dist`, `dist-server`, `.env`, `.data`, `uploads`.

- [x] **Step 2: Write the failing test**

Create `tests/pool.test.ts`:

```ts
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
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/pool.test.ts`
Expected: FAIL — `Failed to resolve import "../server/db/pool"`.

- [x] **Step 4: Write `server/db/pool.ts`**

```ts
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
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/pool.test.ts`
Expected: PASS, 2 tests.

- [x] **Step 6: Create `vitest.config.ts`**

Database tests share one Postgres database, so they must not run in parallel.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB-backed suites share a single test database; parallel files would
    // truncate each other's rows mid-assertion.
    fileParallelism: false,
  },
});
```

- [x] **Step 7: Add database scripts to `package.json`**

Add to `"scripts"`, after `"seed"`:

```json
    "db:migrate": "tsx server/db/migrate.ts",
    "db:seed": "tsx server/seed.ts",
    "db:reset": "tsx server/seed.ts --reset"
```

- [x] **Step 8: Verify the suite still passes**

Run: `npm run check && npm test`
Expected: typecheck clean; 10 tests pass (8 existing + 2 new).

- [x] **Step 9: Commit**

```bash
git add server/db/pool.ts tests/pool.test.ts vitest.config.ts package.json
git commit -m "feat(db): add postgres pool with fail-fast DATABASE_URL requirement"
```

---

### Task 2: Initial schema and advisory-locked migration runner

**Files:**
- Create: `server/migrations/001_initial_schema.sql`
- Create: `server/db/migrate.ts`
- Create: `tests/helpers/db.ts`
- Create: `tests/migrate.test.ts`

**Interfaces:**
- Consumes: `getPool`, `closePool` from `server/db/pool.ts`.
- Produces: `runMigrations(pool: pg.Pool): Promise<number>` returning the count of migrations applied this run, from `server/db/migrate.ts`. `withTestDatabase()`, `truncateAll(pool)` from `tests/helpers/db.ts`.

- [x] **Step 1: Write `server/migrations/001_initial_schema.sql`**

```sql
-- Pind initial relational schema. Replaces the single-document JSONB store.
DROP TABLE IF EXISTS pind_app_state;

CREATE TABLE workspaces (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  short_name            TEXT NOT NULL,
  logo_text             TEXT NOT NULL,
  accent                TEXT NOT NULL CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  surface               TEXT NOT NULL CHECK (surface IN ('warm','cool','paper')),
  portal_headline       TEXT NOT NULL,
  approval_disclaimer   TEXT NOT NULL,
  email_from_name       TEXT NOT NULL,
  require_client_name   BOOLEAN NOT NULL DEFAULT TRUE,
  allow_downloads       BOOLEAN NOT NULL DEFAULT TRUE,
  show_revision_history BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email             TEXT,
  first_name        TEXT,
  last_name         TEXT,
  profile_image_url TEXT,
  role              TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','member')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_workspace_idx ON users (workspace_id);

CREATE TABLE clients (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  company        TEXT NOT NULL,
  email          TEXT NOT NULL,
  avatar         TEXT NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status         TEXT NOT NULL CHECK (status IN ('active','invited','archived')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX clients_workspace_email_key ON clients (workspace_id, lower(email));

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('in-review','changes-requested','approved','draft')),
  due_at       TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress     INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  description  TEXT NOT NULL,
  cover        TEXT NOT NULL,
  budget_label TEXT NOT NULL DEFAULT 'Not set',
  owner        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX projects_workspace_idx ON projects (workspace_id, updated_at DESC);
CREATE INDEX projects_client_idx ON projects (client_id);

CREATE TABLE milestones (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_at     TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('complete','current','upcoming')),
  position   INTEGER NOT NULL
);
CREATE INDEX milestones_project_idx ON milestones (project_id, position);

CREATE TABLE revisions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  version     INTEGER NOT NULL,
  file_name   TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  thumbnail   TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('image','pdf','video','link','file')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT NOT NULL,
  size_label  TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, version)
);
CREATE INDEX revisions_project_idx ON revisions (project_id, version);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('client','studio')),
  body        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('open','resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  reply       TEXT,
  x           REAL CHECK (x >= 0 AND x <= 100),
  y           REAL CHECK (y >= 0 AND y <= 100)
);
CREATE INDEX comments_project_idx ON comments (project_id, created_at DESC);
CREATE INDEX comments_revision_idx ON comments (revision_id);

CREATE TABLE decisions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id  TEXT NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  type         TEXT NOT NULL CHECK (type IN ('approved','changes-requested')),
  client_name  TEXT NOT NULL,
  client_email TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  receipt_code TEXT NOT NULL UNIQUE
);
CREATE INDEX decisions_project_idx ON decisions (project_id, created_at DESC);

CREATE TABLE review_tokens (
  token        TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX review_tokens_project_idx ON review_tokens (project_id);
CREATE UNIQUE INDEX review_tokens_active_project_idx
  ON review_tokens (project_id) WHERE revoked_at IS NULL;

CREATE TABLE activities (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('comment','upload','approval','invite','resolve','project')),
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL,
  actor        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX activities_workspace_idx ON activities (workspace_id, created_at DESC);

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_workspace_idx ON notifications (workspace_id, created_at DESC);
```

- [x] **Step 2: Write the failing test**

Create `tests/helpers/db.ts`:

```ts
import pg from 'pg';
import { runMigrations } from '../../server/db/migrate';

const { Pool } = pg;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/pind_test';

/** Connects to the test database, creating it if it does not exist. */
export async function withTestDatabase(): Promise<pg.Pool> {
  const url = new URL(TEST_DATABASE_URL);
  const databaseName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const admin = new Pool({ connectionString: adminUrl.toString(), ssl: false });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (existing.rowCount === 0) {
      // CREATE DATABASE cannot be parameterised or run inside a transaction.
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL, ssl: false });
  await runMigrations(pool);
  return pool;
}

const TABLES = [
  'notifications', 'activities', 'review_tokens', 'decisions', 'comments',
  'revisions', 'milestones', 'projects', 'clients', 'users', 'workspaces',
];

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
```

Create `tests/migrate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { runMigrations } from '../server/db/migrate';
import { withTestDatabase } from './helpers/db';

let pool: pg.Pool;

beforeAll(async () => { pool = await withTestDatabase(); });
afterAll(async () => { await pool.end(); });

describe('migrations', () => {
  it('creates every expected table', async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = result.rows.map((row) => row.table_name);
    for (const table of [
      'activities', 'clients', 'comments', 'decisions', 'milestones',
      'notifications', 'projects', 'review_tokens', 'revisions',
      'schema_migrations', 'users', 'workspaces',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('records one row per migration file', async () => {
    const result = await pool.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(result.rows).toEqual([{ version: 1 }]);
  });

  it('is a no-op when run again', async () => {
    const applied = await runMigrations(pool);
    expect(applied).toBe(0);
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
    expect(result.rows[0].count).toBe(1);
  });

  it('drops the legacy JSONB state table', async () => {
    const result = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'pind_app_state'`,
    );
    expect(result.rowCount).toBe(0);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/migrate.test.ts`
Expected: FAIL — cannot resolve `../server/db/migrate`.

- [x] **Step 4: Write `server/db/migrate.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool, closePool } from './pool.js';

// Arbitrary but fixed: every instance must contend for the same lock id.
const MIGRATION_LOCK_ID = 8_147_233;

const migrationsDir = path.resolve(fileURLToPath(new URL('../migrations', import.meta.url)));

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await fs.readdir(migrationsDir);
  const files = entries.filter((entry) => entry.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => {
      const version = Number.parseInt(name.slice(0, 3), 10);
      if (!Number.isInteger(version)) {
        throw new Error(`Migration ${name} must start with a three-digit version prefix`);
      }
      return { version, name, sql: await fs.readFile(path.join(migrationsDir, name), 'utf8') };
    }),
  );
}

/**
 * Applies pending migrations and returns how many ran.
 *
 * Replit autoscale can boot several instances at once, so the whole run is
 * wrapped in a session-level advisory lock; losers block, then observe an
 * empty pending set.
 */
export async function runMigrations(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const done = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const seen = new Set(done.rows.map((row) => row.version));

    for (const migration of await loadMigrations()) {
      if (seen.has(migration.version)) continue;
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
          migration.version,
          migration.name,
        ]);
        await client.query('COMMIT');
        applied += 1;
        console.log(`Applied migration ${migration.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

// `npm run db:migrate`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config();
  const applied = await runMigrations(getPool());
  console.log(applied === 0 ? 'Schema already up to date.' : `Applied ${applied} migration(s).`);
  await closePool();
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/migrate.test.ts`
Expected: PASS, 4 tests. If Postgres is unreachable the failure will name the connection, not the assertions.

- [x] **Step 6: Verify the CLI works against a real database**

```bash
createdb pind 2>/dev/null || true
DATABASE_URL=postgres://localhost:5432/pind npm run db:migrate
DATABASE_URL=postgres://localhost:5432/pind npm run db:migrate
psql -d pind -c "\dt"
```

Expected: first run prints `Applied migration 001_initial_schema.sql` then `Applied 1 migration(s).`; second prints `Schema already up to date.`; `\dt` lists twelve tables.

- [x] **Step 7: Commit**

```bash
git add server/db/migrate.ts server/migrations tests/helpers/db.ts tests/migrate.test.ts
git commit -m "feat(db): add advisory-locked migration runner and initial schema"
```

---

### Task 3: Idempotent relational seed

**Files:**
- Modify: `server/seed-data.ts` (add `workspaceId`, export `buildSeed()`)
- Create: `server/db/seed.ts`
- Modify: `server/seed.ts` (CLI entry)
- Modify: `tests/seed.test.ts`

**Interfaces:**
- Consumes: `runMigrations`, `getPool`, `closePool`, `withTestDatabase`, `truncateAll`.
- Produces: `seedWorkspace(pool, options?): Promise<{ inserted: boolean }>` and `resetWorkspace(pool, workspaceId): Promise<void>` from `server/db/seed.ts`; `DEMO_WORKSPACE_ID` constant; `buildSeed(now?: Date): AppState & { workspaceId: string }` from `server/seed-data.ts`.

- [x] **Step 1: Convert `server/seed-data.ts` to a date-anchored builder**

Wrap the existing literal in a function so timestamps re-anchor at seed time. Replace the module top with:

```ts
import type { AppState } from '../shared/types.js';

export const DEMO_WORKSPACE_ID = 'workspace-northstar';

export function buildSeed(now: Date = new Date()): AppState {
  const isoDaysAgo = (days: number, hours = 0) =>
    new Date(now.getTime() - (days * 24 + hours) * 60 * 60 * 1000).toISOString();
  const isoDaysAhead = (days: number) =>
    new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  return {
    // Existing seed literal moved here verbatim — see mechanical steps below.
  };
}

/** Back-compat export used by the existing seed assertions. */
export const seedState: AppState = buildSeed(new Date('2026-08-06T12:00:00.000Z'));
```

This is a mechanical move, not a rewrite. Exactly:

1. Delete current lines 3–5 (the `const now`, `isoDaysAgo`, `isoDaysAhead` module constants).
2. Take the object literal currently spanning `server/seed-data.ts:7-412` — that is, everything from `{` on the `export const seedState: AppState = {` line through the final `};` — and paste it unchanged as the `return` value of `buildSeed`.
3. Do not alter a single property inside the literal. `isoDaysAgo` / `isoDaysAhead` now resolve to the closure-scoped versions, which is the entire point: dates re-anchor to the `now` argument.
4. Verify with `git diff --stat server/seed-data.ts` — the line count should be roughly unchanged, and `npx vitest run tests/seed.test.ts` must still pass the four original assertions, since `seedState` is rebuilt with the same fixed date.

- [x] **Step 2: Write the failing test**

Append to `tests/seed.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DEMO_WORKSPACE_ID } from '../server/seed-data';
import { seedWorkspace } from '../server/db/seed';
import { truncateAll, withTestDatabase } from './helpers/db';

describe('relational seed', () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = await withTestDatabase(); await truncateAll(pool); });
  afterAll(async () => { await pool.end(); });

  async function counts() {
    const tables = ['workspaces', 'clients', 'projects', 'milestones', 'revisions', 'comments', 'decisions', 'review_tokens', 'activities', 'notifications'];
    const entries = await Promise.all(tables.map(async (table) => {
      const result = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
      return [table, result.rows[0].count] as const;
    }));
    return Object.fromEntries(entries);
  }

  it('inserts the Northstar workspace on first run', async () => {
    const result = await seedWorkspace(pool);
    expect(result.inserted).toBe(true);
    const after = await counts();
    expect(after.workspaces).toBe(1);
    expect(after.clients).toBe(4);
    expect(after.projects).toBe(4);
    expect(after.review_tokens).toBe(4);
  });

  it('does not duplicate when seeded repeatedly', async () => {
    const before = await counts();
    await seedWorkspace(pool);
    await seedWorkspace(pool);
    expect(await counts()).toEqual(before);
  });

  it('links every decision to a revision of the same project', async () => {
    const result = await pool.query<{ bad: number }>(`
      SELECT COUNT(*)::int AS bad FROM decisions d
      JOIN revisions r ON r.id = d.revision_id
      WHERE r.project_id <> d.project_id
    `);
    expect(result.rows[0].bad).toBe(0);
  });

  it('gives every project exactly one active review token', async () => {
    const result = await pool.query<{ project_id: string; count: number }>(`
      SELECT project_id, COUNT(*)::int AS count FROM review_tokens
      WHERE revoked_at IS NULL GROUP BY project_id
    `);
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows) expect(row.count).toBe(1);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/seed.test.ts`
Expected: FAIL — cannot resolve `../server/db/seed`.

- [x] **Step 4: Write `server/db/seed.ts`**

```ts
import pg from 'pg';
import type { AppState } from '../../shared/types.js';
import { DEMO_WORKSPACE_ID, buildSeed } from '../seed-data.js';

/**
 * Writes the demo workspace. Every statement is ON CONFLICT DO NOTHING keyed
 * on the seed's stable natural IDs, so repeated runs insert nothing.
 */
export async function seedWorkspace(
  pool: pg.Pool,
  options: { workspaceId?: string; state?: AppState } = {},
): Promise<{ inserted: boolean }> {
  const workspaceId = options.workspaceId ?? DEMO_WORKSPACE_ID;
  const state = options.state ?? buildSeed();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const workspace = await client.query(
      `INSERT INTO workspaces (id, name, short_name, logo_text, accent, surface,
         portal_headline, approval_disclaimer, email_from_name,
         require_client_name, allow_downloads, show_revision_history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [workspaceId, state.workspace.name, state.workspace.shortName, state.workspace.logoText,
       state.workspace.accent, state.workspace.surface, state.workspace.portalHeadline,
       state.workspace.approvalDisclaimer, state.workspace.emailFromName,
       state.workspace.requireClientName, state.workspace.allowDownloads,
       state.workspace.showRevisionHistory],
    );

    for (const item of state.clients) {
      await client.query(
        `INSERT INTO clients (id, workspace_id, name, company, email, avatar, last_active_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [item.id, workspaceId, item.name, item.company, item.email, item.avatar, item.lastActiveAt, item.status],
      );
    }

    for (const project of state.projects) {
      await client.query(
        `INSERT INTO projects (id, workspace_id, client_id, name, category, status, due_at,
           updated_at, progress, description, cover, budget_label, owner)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [project.id, workspaceId, project.clientId, project.name, project.category, project.status,
         project.dueAt, project.updatedAt, project.progress, project.description, project.cover,
         project.budgetLabel, project.owner],
      );

      await client.query(
        `INSERT INTO review_tokens (token, project_id) VALUES ($1,$2) ON CONFLICT (token) DO NOTHING`,
        [project.reviewToken, project.id],
      );

      for (const [index, milestone] of project.milestones.entries()) {
        await client.query(
          `INSERT INTO milestones (id, project_id, title, due_at, status, position)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [milestone.id, project.id, milestone.title, milestone.dueAt, milestone.status, index],
        );
      }

      for (const revision of project.revisions) {
        await client.query(
          `INSERT INTO revisions (id, project_id, label, version, file_name, file_url, thumbnail,
             kind, uploaded_at, uploaded_by, size_label, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [revision.id, project.id, revision.label, revision.version, revision.fileName,
           revision.fileUrl, revision.thumbnail ?? null, revision.kind, revision.uploadedAt,
           revision.uploadedBy, revision.sizeLabel, revision.note],
        );
      }

      for (const comment of project.comments) {
        await client.query(
          `INSERT INTO comments (id, project_id, revision_id, author, author_role, body, status,
             created_at, resolved_at, reply, x, y)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [comment.id, project.id, comment.revisionId, comment.author, comment.authorRole,
           comment.body, comment.status, comment.createdAt, comment.resolvedAt ?? null,
           comment.reply ?? null, comment.x ?? null, comment.y ?? null],
        );
      }

      for (const decision of project.decisions) {
        await client.query(
          `INSERT INTO decisions (id, project_id, revision_id, type, client_name, client_email,
             note, created_at, receipt_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [decision.id, project.id, decision.revisionId, decision.type, decision.clientName,
           decision.clientEmail, decision.note, decision.createdAt, decision.receiptCode],
        );
      }
    }

    for (const activity of state.activities) {
      await client.query(
        `INSERT INTO activities (id, workspace_id, project_id, type, title, detail, actor, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [activity.id, workspaceId, activity.projectId ?? null, activity.type, activity.title,
         activity.detail, activity.actor, activity.createdAt],
      );
    }

    for (const notification of state.notifications) {
      await client.query(
        `INSERT INTO notifications (id, workspace_id, project_id, title, body, read, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [notification.id, workspaceId, notification.projectId ?? null, notification.title,
         notification.body, notification.read, notification.createdAt],
      );
    }

    await client.query('COMMIT');
    return { inserted: (workspace.rowCount ?? 0) > 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Deletes one workspace and re-seeds it. Cascades remove all children. */
export async function resetWorkspace(pool: pg.Pool, workspaceId = DEMO_WORKSPACE_ID): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await seedWorkspace(pool, { workspaceId });
}
```

Note: `projects.client_id` is `ON DELETE RESTRICT`, but deleting the *workspace* cascades to both `clients` and `projects`, so `resetWorkspace` needs no ordering.

- [x] **Step 5: Rewrite `server/seed.ts` as the CLI**

```ts
import 'dotenv/config';
import { closePool, getPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { resetWorkspace, seedWorkspace } from './db/seed.js';
import { DEMO_WORKSPACE_ID } from './seed-data.js';

const pool = getPool();
await runMigrations(pool);

if (process.argv.includes('--reset')) {
  await resetWorkspace(pool, DEMO_WORKSPACE_ID);
  console.log('Northstar demo workspace reset.');
} else {
  const { inserted } = await seedWorkspace(pool);
  console.log(inserted ? 'Northstar demo workspace seeded.' : 'Northstar demo workspace already present.');
}

await closePool();
```

- [x] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/seed.test.ts`
Expected: PASS — the 4 original `seedState` assertions plus the 4 new relational ones.

- [x] **Step 7: Verify idempotency against a real database**

```bash
DATABASE_URL=postgres://localhost:5432/pind npm run db:seed
DATABASE_URL=postgres://localhost:5432/pind npm run db:seed
DATABASE_URL=postgres://localhost:5432/pind npm run db:seed
psql -d pind -c "SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM clients) AS clients, (SELECT COUNT(*) FROM comments) AS comments;"
```

Expected: first run prints `seeded`, the next two print `already present`; counts are exactly `4 | 4 | 5` (3 comments on Summer Packaging + 2 on Autumn Editorial).

- [x] **Step 8: Commit**

```bash
git add server/seed-data.ts server/db/seed.ts server/seed.ts tests/seed.test.ts
git commit -m "feat(db): add idempotent relational seed for the Northstar demo"
```

---

### Task 4: Assemble `AppState` from relational queries

**Files:**
- Create: `server/db/rows.ts`
- Create: `server/db/assemble.ts`
- Create: `tests/repository.test.ts`

**Interfaces:**
- Consumes: `withTestDatabase`, `truncateAll`, `seedWorkspace`, `DEMO_WORKSPACE_ID`.
- Produces: `readAppState(db, workspaceId): Promise<AppState | null>` from `server/db/assemble.ts`; `type Queryable = pg.Pool | pg.PoolClient` and row-mapper helpers from `server/db/rows.ts`.

- [x] **Step 1: Write `server/db/rows.ts`**

```ts
import type pg from 'pg';

/** Accepts either the pool or a checked-out client inside a transaction. */
export type Queryable = pg.Pool | pg.PoolClient;

/** TIMESTAMPTZ arrives as a Date; AppState uses ISO-8601 strings. */
export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isoOrUndefined(value: Date | string | null): string | undefined {
  return value === null ? undefined : iso(value);
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const group = map.get(key(item));
    if (group) group.push(item);
    else map.set(key(item), [item]);
  }
  return map;
}
```

- [x] **Step 2: Write the failing test**

Create `tests/repository.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { readAppState } from '../server/db/assemble';
import { seedWorkspace } from '../server/db/seed';
import { DEMO_WORKSPACE_ID } from '../server/seed-data';
import { truncateAll, withTestDatabase } from './helpers/db';

let pool: pg.Pool;

beforeAll(async () => {
  pool = await withTestDatabase();
  await truncateAll(pool);
  await seedWorkspace(pool);
});
afterAll(async () => { await pool.end(); });

describe('readAppState', () => {
  it('returns null for an unknown workspace', async () => {
    expect(await readAppState(pool, 'workspace-missing')).toBeNull();
  });

  it('assembles the full workspace with nested project children', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    expect(state.workspace.name).toBe('Northstar Creative');
    expect(state.clients).toHaveLength(4);
    expect(state.projects).toHaveLength(4);

    const ember = state.projects.find((project) => project.id === 'project-ember-packaging')!;
    expect(ember.revisions).toHaveLength(3);
    expect(ember.revisions.map((revision) => revision.version)).toEqual([1, 2, 3]);
    expect(ember.milestones.length).toBeGreaterThan(0);
    expect(ember.reviewToken).toBe('ember-summer-7k9qA4mT8vR2xP6cN1');
  });

  it('derives clientName from the joined client company', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    const ember = state.projects.find((project) => project.id === 'project-ember-packaging')!;
    expect(ember.clientName).toBe('Ember Coffee');
  });

  it('derives activeProjects from non-approved project counts', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    for (const client of state.clients) {
      const expected = state.projects.filter(
        (project) => project.clientId === client.id && project.status !== 'approved',
      ).length;
      expect(client.activeProjects).toBe(expected);
    }
  });

  it('emits ISO-8601 strings, never Date objects', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    expect(typeof state.projects[0].updatedAt).toBe('string');
    expect(state.projects[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof state.activities[0].createdAt).toBe('string');
  });

  it('rejects a duplicate client email with a unique violation', async () => {
    await expect(
      pool.query(
        `INSERT INTO clients (id, workspace_id, name, company, email, avatar, last_active_at, status)
         VALUES ('client-dupe',$1,'Copy','Copy Co','DARA@ember.example','CC',NOW(),'active')`,
        [DEMO_WORKSPACE_ID],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/repository.test.ts`
Expected: FAIL — cannot resolve `../server/db/assemble`.

- [x] **Step 4: Write `server/db/assemble.ts`**

```ts
import type {
  Activity, AppState, Client, Comment, Decision, Milestone,
  Notification, Project, ReviewPayload, Revision, WorkspaceSettings,
} from '../../shared/types.js';
import { type Queryable, groupBy, iso, isoOrUndefined } from './rows.js';

const ACTIVITY_LIMIT = 100;
const NOTIFICATION_LIMIT = 50;

function toWorkspace(row: Record<string, any>): WorkspaceSettings {
  return {
    name: row.name,
    shortName: row.short_name,
    logoText: row.logo_text,
    accent: row.accent,
    surface: row.surface,
    portalHeadline: row.portal_headline,
    approvalDisclaimer: row.approval_disclaimer,
    emailFromName: row.email_from_name,
    requireClientName: row.require_client_name,
    allowDownloads: row.allow_downloads,
    showRevisionHistory: row.show_revision_history,
  };
}

function toClient(row: Record<string, any>): Client {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    avatar: row.avatar,
    activeProjects: row.active_projects,
    lastActiveAt: iso(row.last_active_at),
    status: row.status,
  };
}

function toRevision(row: Record<string, any>): Revision {
  return {
    id: row.id,
    label: row.label,
    version: row.version,
    fileName: row.file_name,
    fileUrl: row.file_url,
    thumbnail: row.thumbnail ?? undefined,
    kind: row.kind,
    uploadedAt: iso(row.uploaded_at),
    uploadedBy: row.uploaded_by,
    sizeLabel: row.size_label,
    note: row.note,
  };
}

function toComment(row: Record<string, any>): Comment {
  return {
    id: row.id,
    projectId: row.project_id,
    revisionId: row.revision_id,
    author: row.author,
    authorRole: row.author_role,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
    resolvedAt: isoOrUndefined(row.resolved_at),
    reply: row.reply ?? undefined,
    x: row.x ?? undefined,
    y: row.y ?? undefined,
  };
}

function toMilestone(row: Record<string, any>): Milestone {
  return { id: row.id, title: row.title, dueAt: iso(row.due_at), status: row.status };
}

function toDecision(row: Record<string, any>): Decision {
  return {
    id: row.id,
    type: row.type,
    revisionId: row.revision_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    note: row.note,
    createdAt: iso(row.created_at),
    receiptCode: row.receipt_code,
  };
}

/** Builds Project objects for the given project rows, fetching their children. */
async function attachProjectChildren(
  db: Queryable,
  projectRows: Record<string, any>[],
): Promise<Project[]> {
  const ids = projectRows.map((row) => row.id);
  if (ids.length === 0) return [];

  const [milestones, revisions, comments, decisions, tokens] = await Promise.all([
    db.query(`SELECT * FROM milestones WHERE project_id = ANY($1) ORDER BY position ASC`, [ids]),
    db.query(`SELECT * FROM revisions WHERE project_id = ANY($1) ORDER BY version ASC`, [ids]),
    db.query(`SELECT * FROM comments WHERE project_id = ANY($1) ORDER BY created_at DESC`, [ids]),
    db.query(`SELECT * FROM decisions WHERE project_id = ANY($1) ORDER BY created_at DESC`, [ids]),
    db.query(
      `SELECT project_id, token FROM review_tokens
       WHERE project_id = ANY($1) AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [ids],
    ),
  ]);

  const milestonesBy = groupBy(milestones.rows, (row) => row.project_id);
  const revisionsBy = groupBy(revisions.rows, (row) => row.project_id);
  const commentsBy = groupBy(comments.rows, (row) => row.project_id);
  const decisionsBy = groupBy(decisions.rows, (row) => row.project_id);
  const tokenBy = new Map(tokens.rows.map((row) => [row.project_id, row.token]));

  return projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    clientName: row.client_name,
    category: row.category,
    status: row.status,
    dueAt: iso(row.due_at),
    updatedAt: iso(row.updated_at),
    progress: row.progress,
    description: row.description,
    cover: row.cover,
    reviewToken: tokenBy.get(row.id) ?? '',
    budgetLabel: row.budget_label,
    owner: row.owner,
    revisions: (revisionsBy.get(row.id) ?? []).map(toRevision),
    comments: (commentsBy.get(row.id) ?? []).map(toComment),
    milestones: (milestonesBy.get(row.id) ?? []).map(toMilestone),
    decisions: (decisionsBy.get(row.id) ?? []).map(toDecision),
  }));
}

/** Assembles the whole workspace in the AppState shape the client expects. */
export async function readAppState(db: Queryable, workspaceId: string): Promise<AppState | null> {
  const workspace = await db.query(`SELECT * FROM workspaces WHERE id = $1`, [workspaceId]);
  if (workspace.rowCount === 0) return null;

  const [clients, projects, activities, notifications] = await Promise.all([
    db.query(
      `SELECT c.*, (
         SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.status <> 'approved'
       ) AS active_projects
       FROM clients c WHERE c.workspace_id = $1
       ORDER BY c.created_at DESC, c.id`,
      [workspaceId],
    ),
    db.query(
      `SELECT p.*, c.company AS client_name FROM projects p
       JOIN clients c ON c.id = p.client_id
       WHERE p.workspace_id = $1 ORDER BY p.updated_at DESC`,
      [workspaceId],
    ),
    db.query(
      `SELECT * FROM activities WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [workspaceId, ACTIVITY_LIMIT],
    ),
    db.query(
      `SELECT * FROM notifications WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [workspaceId, NOTIFICATION_LIMIT],
    ),
  ]);

  return {
    schemaVersion: 1,
    workspace: toWorkspace(workspace.rows[0]),
    // Overwritten by the caller with live environment flags.
    integrations: { database: true, email: false, cloudinary: false, slack: false },
    clients: clients.rows.map(toClient),
    projects: await attachProjectChildren(db, projects.rows),
    activities: activities.rows.map((row): Activity => ({
      id: row.id,
      type: row.type,
      title: row.title,
      detail: row.detail,
      actor: row.actor,
      projectId: row.project_id ?? undefined,
      createdAt: iso(row.created_at),
    })),
    notifications: notifications.rows.map((row): Notification => ({
      id: row.id,
      title: row.title,
      body: row.body,
      read: row.read,
      projectId: row.project_id ?? undefined,
      createdAt: iso(row.created_at),
    })),
  };
}

export { attachProjectChildren, toWorkspace, toClient };
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/repository.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 6: Typecheck and commit**

```bash
npm run check
git add server/db/rows.ts server/db/assemble.ts tests/repository.test.ts
git commit -m "feat(db): assemble AppState from relational queries"
```

---

### Task 5: Project-scoped review payload

**Files:**
- Modify: `server/db/assemble.ts`
- Modify: `tests/repository.test.ts`

**Interfaces:**
- Consumes: `attachProjectChildren`, `toWorkspace`, `toClient` from Task 4.
- Produces: `readReviewPayload(db, token): Promise<ReviewPayload | null>`.

- [x] **Step 1: Write the failing test**

Append to `tests/repository.test.ts`:

```ts
import { readReviewPayload } from '../server/db/assemble';

describe('readReviewPayload', () => {
  const token = 'ember-summer-7k9qA4mT8vR2xP6cN1';

  it('returns only the token’s own project', async () => {
    const payload = (await readReviewPayload(pool, token))!;
    expect(payload.project.id).toBe('project-ember-packaging');
    expect(payload.workspace.name).toBe('Northstar Creative');
    expect(payload.client?.company).toBe('Ember Coffee');
    // The payload must not carry any workspace-wide collections.
    expect(payload).not.toHaveProperty('projects');
    expect(payload).not.toHaveProperty('clients');
    expect(payload).not.toHaveProperty('activities');
    expect(payload).not.toHaveProperty('notifications');
    expect(Object.keys(payload).sort()).toEqual(['client', 'project', 'workspace']);
  });

  it('loads the project’s revisions and comments', async () => {
    const payload = (await readReviewPayload(pool, token))!;
    expect(payload.project.revisions).toHaveLength(3);
    expect(payload.project.comments.every((comment) => comment.projectId === 'project-ember-packaging')).toBe(true);
  });

  it('returns null for an unknown token', async () => {
    expect(await readReviewPayload(pool, 'not-a-real-token')).toBeNull();
  });

  it('returns null once the token is revoked', async () => {
    await pool.query(`UPDATE review_tokens SET revoked_at = NOW() WHERE token = $1`, [token]);
    expect(await readReviewPayload(pool, token)).toBeNull();
    await pool.query(`UPDATE review_tokens SET revoked_at = NULL WHERE token = $1`, [token]);
  });

  it('returns null once the token has expired', async () => {
    await pool.query(`UPDATE review_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE token = $1`, [token]);
    expect(await readReviewPayload(pool, token)).toBeNull();
    await pool.query(`UPDATE review_tokens SET expires_at = NULL WHERE token = $1`, [token]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/repository.test.ts -t readReviewPayload`
Expected: FAIL — `readReviewPayload is not a function`.

- [x] **Step 3: Add `readReviewPayload` to `server/db/assemble.ts`**

```ts
/**
 * Loads exactly one project by review token.
 *
 * The public review portal must never see workspace-wide data, so this never
 * touches the clients, projects, activities, or notifications collections —
 * only the token's own project, its client, and the workspace branding.
 */
export async function readReviewPayload(db: Queryable, token: string): Promise<ReviewPayload | null> {
  const result = await db.query(
    `SELECT p.*, c.company AS client_name FROM review_tokens t
     JOIN projects p ON p.id = t.project_id
     JOIN clients c ON c.id = p.client_id
     WHERE t.token = $1
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [token],
  );
  if (result.rowCount === 0) return null;

  const projectRow = result.rows[0];
  const [projects, workspace, client] = await Promise.all([
    attachProjectChildren(db, [projectRow]),
    db.query(`SELECT * FROM workspaces WHERE id = $1`, [projectRow.workspace_id]),
    db.query(
      `SELECT c.*, (
         SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.status <> 'approved'
       ) AS active_projects
       FROM clients c WHERE c.id = $1`,
      [projectRow.client_id],
    ),
  ]);

  // Audit trail. Awaited rather than fire-and-forget: `db` may be a checked-out
  // client, and issuing an unawaited query on one interleaves with whatever the
  // caller runs next on the same connection.
  await db.query(`UPDATE review_tokens SET last_used_at = NOW() WHERE token = $1`, [token])
    .catch((error) => console.error('Could not record review token use', error));

  return {
    project: projects[0],
    workspace: toWorkspace(workspace.rows[0]),
    client: client.rows[0] ? toClient(client.rows[0]) : undefined,
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/repository.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Typecheck and commit**

```bash
npm run check && npm test
git add server/db/assemble.ts tests/repository.test.ts
git commit -m "feat(db): scope review payload to a single project by token"
```

---

### Task 6: Repository rewrite, mutation helpers, client and project routes

**Files:**
- Modify: `server/repository.ts` (full rewrite)
- Create: `server/db/writes.ts`
- Modify: `server/index.ts:95-110` (delete `updateState`/`writeQueue`), `:307-382` (clients, projects)

**Interfaces:**
- Consumes: `readAppState`, `readReviewPayload`, `resetWorkspace`, `getPool`.
- Produces: `createRepository(): Repository` with `read`, `readReviewPayload`, `transaction`, `reset`; and from `server/db/writes.ts`: `addActivity(tx, input)`, `addNotification(tx, input)`, `touchClient(tx, clientId)`, `requireProject(tx, projectId)`, `requireProjectByToken(tx, token)`, `requireRevision(tx, projectId, revisionId)`. Also `mutate(fn)` in `server/index.ts`.

- [x] **Step 1: Rewrite `server/repository.ts`**

Replace the entire file:

```ts
import type pg from 'pg';
import type { AppState, ReviewPayload } from '../shared/types.js';
import { getPool } from './db/pool.js';
import { readAppState, readReviewPayload } from './db/assemble.js';
import { resetWorkspace } from './db/seed.js';

export interface Repository {
  mode: 'postgres';
  read(workspaceId: string): Promise<AppState>;
  readReviewPayload(token: string): Promise<ReviewPayload | null>;
  transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T>;
  reset(workspaceId: string): Promise<AppState>;
}

class PostgresRepository implements Repository {
  mode = 'postgres' as const;

  async read(workspaceId: string): Promise<AppState> {
    const state = await readAppState(getPool(), workspaceId);
    if (!state) {
      const error = new Error(`Workspace ${workspaceId} was not found`) as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return state;
  }

  readReviewPayload(token: string): Promise<ReviewPayload | null> {
    return readReviewPayload(getPool(), token);
  }

  /** Runs fn inside a real transaction, rolling back on any rejection. */
  async transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reset(workspaceId: string): Promise<AppState> {
    await resetWorkspace(getPool(), workspaceId);
    return this.read(workspaceId);
  }
}

export function createRepository(): Repository {
  return new PostgresRepository();
}
```

The `FileRepository` class is deleted entirely.

- [x] **Step 2: Write `server/db/writes.ts`**

```ts
import type pg from 'pg';
import { nanoid } from 'nanoid';
import type { Activity, Notification, Project } from '../../shared/types.js';

export async function addActivity(
  tx: pg.PoolClient,
  input: Omit<Activity, 'id' | 'createdAt'> & { workspaceId: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO activities (id, workspace_id, project_id, type, title, detail, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [`activity-${nanoid(8)}`, input.workspaceId, input.projectId ?? null, input.type,
     input.title, input.detail, input.actor],
  );
}

export async function addNotification(
  tx: pg.PoolClient,
  input: Omit<Notification, 'id' | 'createdAt' | 'read'> & { workspaceId: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications (id, workspace_id, project_id, title, body)
     VALUES ($1,$2,$3,$4,$5)`,
    [`notification-${nanoid(8)}`, input.workspaceId, input.projectId ?? null, input.title, input.body],
  );
}

/** Marks a client active, mirroring the old touchClient() behaviour. */
export async function touchClient(tx: pg.PoolClient, clientId: string): Promise<void> {
  await tx.query(
    `UPDATE clients SET last_active_at = NOW(), status = 'active' WHERE id = $1`,
    [clientId],
  );
}

/** Loads a project for update, throwing a 404 the error middleware understands. */
export async function requireProject(
  tx: pg.PoolClient,
  projectId: string,
): Promise<{ id: string; workspace_id: string; client_id: string; name: string; status: Project['status']; progress: number }> {
  const result = await tx.query(
    `SELECT id, workspace_id, client_id, name, status, progress FROM projects WHERE id = $1 FOR UPDATE`,
    [projectId],
  );
  if (result.rowCount === 0) {
    const error = new Error('Project not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

/** Loads a project by review token, locking it for the duration of the write. */
export async function requireProjectByToken(
  tx: pg.PoolClient,
  token: string,
): Promise<{ id: string; workspace_id: string; client_id: string; name: string; status: Project['status']; progress: number }> {
  const result = await tx.query(
    `SELECT p.id, p.workspace_id, p.client_id, p.name, p.status, p.progress
     FROM review_tokens t JOIN projects p ON p.id = t.project_id
     WHERE t.token = $1 AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > NOW())
     FOR UPDATE OF p`,
    [token],
  );
  if (result.rowCount === 0) {
    const error = new Error('Review link not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

/** Ensures a revision belongs to the project, throwing 400 like the old code. */
export async function requireRevision(
  tx: pg.PoolClient,
  projectId: string,
  revisionId: string,
): Promise<{ id: string; label: string; version: number }> {
  const result = await tx.query(
    `SELECT id, label, version FROM revisions WHERE id = $1 AND project_id = $2`,
    [revisionId, projectId],
  );
  if (result.rowCount === 0) {
    const error = new Error('Revision not found') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return result.rows[0];
}
```

- [x] **Step 3: Delete `updateState` and `writeQueue` from `server/index.ts`**

Remove lines 95–110 (the `writeQueue` declaration and the whole `updateState` function). Add near the top, after `const repository = createRepository();`:

```ts
import { DEMO_WORKSPACE_ID } from './seed-data.js';

// Cycle 2 replaces this with the authenticated user's workspace.
const workspaceId = DEMO_WORKSPACE_ID;

/** Runs a mutation in a transaction, then returns the freshly-read state. */
async function mutate(fn: (tx: pg.PoolClient) => Promise<void>): Promise<AppState> {
  await repository.transaction(fn);
  const state = await repository.read(workspaceId);
  state.integrations = integrationFlags(repository.mode);
  return state;
}
```

Add `import type pg from 'pg';` to the import block.

- [x] **Step 4: Rewrite `POST /api/clients`**

```ts
app.post('/api/clients', route(async (req, res) => {
  const input = createClientSchema.parse(req.body);
  const state = await mutate(async (tx) => {
    const avatar = input.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    // The UNIQUE (workspace_id, lower(email)) index enforces this; a 23505
    // is mapped to HTTP 409 by the error middleware.
    await tx.query(
      `INSERT INTO clients (id, workspace_id, name, company, email, avatar, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')`,
      [`client-${nanoid(10)}`, workspaceId, input.name, input.company, input.email.toLowerCase(), avatar],
    );
    await addActivity(tx, {
      workspaceId,
      type: 'project',
      title: `${input.company} added`,
      detail: `${input.name} was added to the client directory.`,
      actor: 'Maya Okeke',
    });
  });
  res.status(201).json(state);
}));
```

- [x] **Step 5: Rewrite `POST /api/projects`**

```ts
app.post('/api/projects', route(async (req, res) => {
  const input = createProjectSchema.parse(req.body);
  const state = await mutate(async (tx) => {
    const client = await tx.query(`SELECT id, company FROM clients WHERE id = $1 AND workspace_id = $2`,
      [input.clientId, workspaceId]);
    if (client.rowCount === 0) {
      const error = new Error('Client not found') as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    const id = `project-${nanoid(10)}`;
    await tx.query(
      `INSERT INTO projects (id, workspace_id, client_id, name, category, status, due_at,
         progress, description, cover, budget_label, owner)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,12,$7,'/assets/field.svg',$8,'Maya Okeke')`,
      [id, workspaceId, input.clientId, input.name, input.category, input.dueAt,
       input.description, input.budgetLabel],
    );

    const token = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 22)}-${nanoid(18)}`;
    await tx.query(`INSERT INTO review_tokens (token, project_id) VALUES ($1,$2)`, [token, id]);

    await tx.query(
      `INSERT INTO milestones (id, project_id, title, due_at, status, position) VALUES
         ($1,$2,'Project kickoff',NOW(),'complete',0),
         ($3,$2,'First review',$4,'current',1)`,
      [`milestone-${nanoid(6)}`, id, `milestone-${nanoid(6)}`, input.dueAt],
    );

    await addActivity(tx, {
      workspaceId,
      projectId: id,
      type: 'project',
      title: `${input.name} created`,
      detail: `A new ${input.category.toLowerCase()} project was created for ${client.rows[0].company}.`,
      actor: 'Maya Okeke',
    });
  });
  res.status(201).json(state);
}));
```

Note the old code incremented `client.activeProjects` here. That is now derived, so the increment disappears — the count updates automatically because the new project's status is `draft`.

- [x] **Step 6: Typecheck**

Run: `npm run check`
Expected: clean. The remaining routes still reference `updateState`, so fix them in Tasks 7–8 before running the server.

- [x] **Step 7: Commit**

```bash
git add server/repository.ts server/db/writes.ts server/index.ts
git commit -m "feat(db): move repository and client/project routes onto transactions"
```

---

### Task 7: Comment, resolve, and revision routes

**Files:**
- Modify: `server/index.ts` (review comments, project comments, resolve, revisions)

**Interfaces:**
- Consumes: `mutate`, `addActivity`, `addNotification`, `touchClient`, `requireProject`, `requireProjectByToken`, `requireRevision`.
- Produces: nothing new.

- [x] **Step 1: Rewrite `POST /api/review/:token/comments`**

```ts
app.post('/api/review/:token/comments', route(async (req, res) => {
  const input = commentSchema.parse(req.body);
  await repository.transaction(async (tx) => {
    const project = await requireProjectByToken(tx, req.params.token);
    const revision = await requireRevision(tx, project.id, input.revisionId);
    await tx.query(
      `INSERT INTO comments (id, project_id, revision_id, author, author_role, body, status, x, y)
       VALUES ($1,$2,$3,$4,'client',$5,'open',$6,$7)`,
      [`comment-${nanoid(8)}`, project.id, revision.id, input.author, input.body,
       input.x ?? null, input.y ?? null],
    );
    await tx.query(`UPDATE projects SET updated_at = NOW(), status = 'in-review' WHERE id = $1`, [project.id]);
    await touchClient(tx, project.client_id);
    await addActivity(tx, {
      workspaceId: project.workspace_id, projectId: project.id, type: 'comment',
      title: `New comment on ${project.name}`, detail: input.body, actor: input.author,
    });
    await addNotification(tx, {
      workspaceId: project.workspace_id, projectId: project.id,
      title: 'New client feedback', body: `${input.author} commented on ${revision.label}.`,
    });
  });
  const payload = await repository.readReviewPayload(req.params.token);
  res.status(201).json(payload);
}));
```

- [x] **Step 2: Rewrite `POST /api/projects/:id/comments`**

```ts
app.post('/api/projects/:id/comments', route(async (req, res) => {
  const input = commentSchema.parse(req.body);
  const state = await mutate(async (tx) => {
    const project = await requireProject(tx, req.params.id);
    const revision = await requireRevision(tx, project.id, input.revisionId);
    await tx.query(
      `INSERT INTO comments (id, project_id, revision_id, author, author_role, body, status, x, y)
       VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8)`,
      [`comment-${nanoid(8)}`, project.id, revision.id, input.author, input.authorRole,
       input.body, input.x ?? null, input.y ?? null],
    );
    if (input.authorRole === 'client') {
      await tx.query(`UPDATE projects SET updated_at = NOW(), status = 'in-review' WHERE id = $1`, [project.id]);
      await touchClient(tx, project.client_id);
      await addNotification(tx, {
        workspaceId: project.workspace_id, projectId: project.id,
        title: 'New client feedback', body: `${input.author} commented on ${revision.label}.`,
      });
    } else {
      await tx.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [project.id]);
    }
    await addActivity(tx, {
      workspaceId: project.workspace_id, projectId: project.id, type: 'comment',
      title: `New comment on ${project.name}`, detail: input.body, actor: input.author,
    });
  });
  res.status(201).json(state);
}));
```

- [x] **Step 3: Rewrite `PATCH /api/comments/:id/resolve`**

```ts
app.patch('/api/comments/:id/resolve', route(async (req, res) => {
  const reply = typeof req.body?.reply === 'string' ? req.body.reply.slice(0, 400) : '';
  const state = await mutate(async (tx) => {
    const result = await tx.query(
      `UPDATE comments SET status = 'resolved', resolved_at = NOW(),
         reply = COALESCE(NULLIF($2,''), reply)
       WHERE id = $1
       RETURNING project_id, body`,
      [req.params.id, reply],
    );
    if (result.rowCount === 0) {
      const error = new Error('Comment not found') as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    const { project_id: projectId, body } = result.rows[0];
    await tx.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
    await addActivity(tx, {
      workspaceId, projectId, type: 'resolve',
      title: 'Feedback resolved', detail: body, actor: 'Maya Okeke',
    });
  });
  res.json(state);
}));
```

- [x] **Step 4: Rewrite `POST /api/projects/:id/revisions`**

Keep the existing multer upload and Cloudinary/local fallback block exactly as it is. Replace only the `updateState` call:

```ts
  const state = await mutate(async (tx) => {
    const project = await requireProject(tx, projectId);
    // UNIQUE (project_id, version) makes this safe under concurrent uploads;
    // a collision surfaces as 23505 rather than two rows sharing a version.
    const next = await tx.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM revisions WHERE project_id = $1`,
      [projectId],
    );
    const version = next.rows[0].version;
    const kind: Revision['kind'] = req.file!.mimetype.startsWith('image/')
      ? 'image'
      : req.file!.mimetype.startsWith('video/')
        ? 'video'
        : req.file!.mimetype.includes('pdf') ? 'pdf' : 'file';

    await tx.query(
      `INSERT INTO revisions (id, project_id, label, version, file_name, file_url, thumbnail,
         kind, uploaded_by, size_label, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Maya Okeke',$9,$10)`,
      [`revision-${nanoid(8)}`, projectId, label, version, req.file!.originalname, fileUrl,
       kind === 'image' ? fileUrl : null, kind,
       `${(req.file!.size / (1024 * 1024)).toFixed(1)} MB`, note],
    );
    await tx.query(
      `UPDATE projects SET updated_at = NOW(), status = 'in-review',
         progress = LEAST(95, progress + 12) WHERE id = $1`,
      [projectId],
    );
    await addActivity(tx, {
      workspaceId: project.workspace_id, projectId, type: 'upload',
      title: `Revision ${version} uploaded`,
      detail: `${req.file!.originalname} was stored with ${provider}.`, actor: 'Maya Okeke',
    });
    await addNotification(tx, {
      workspaceId: project.workspace_id, projectId,
      title: 'Revision ready to share', body: `${project.name} now has revision ${version}.`,
    });
  });
```

- [x] **Step 5: Typecheck**

Run: `npm run check`
Expected: clean apart from the not-yet-converted decision/invite/settings routes.

- [x] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat(db): move comment and revision routes onto transactions"
```

---

### Task 8: Decision, invite, settings, notification, and reset routes

**Files:**
- Modify: `server/index.ts` (both decision routes, invite, settings, notifications, demo reset, bootstrap, health, review GET)

**Interfaces:**
- Consumes: everything from Tasks 6–7.
- Produces: nothing new.

- [x] **Step 1: Extract the shared decision write**

Both decision routes ran identical logic against different lookups. Add one helper above the routes:

```ts
/** Applies a client decision. Shared by the studio and public review routes. */
async function applyDecision(
  tx: pg.PoolClient,
  project: { id: string; workspace_id: string; client_id: string; name: string; status: Project['status'] },
  input: { type: DecisionType; revisionId: string; clientName: string; clientEmail: string; note: string },
): Promise<void> {
  const revision = await requireRevision(tx, project.id, input.revisionId);
  const company = await tx.query<{ company: string }>(`SELECT company FROM clients WHERE id = $1`, [project.client_id]);
  const receiptCode = `PND-${(company.rows[0]?.company ?? '').replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()}-${nanoid(6).toUpperCase()}`;

  await tx.query(
    `INSERT INTO decisions (id, project_id, revision_id, type, client_name, client_email, note, receipt_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [`decision-${nanoid(8)}`, project.id, revision.id, input.type, input.clientName,
     input.clientEmail, input.note, receiptCode],
  );

  await tx.query(
    `UPDATE projects SET status = $2, updated_at = NOW(),
       progress = CASE WHEN $2 = 'approved' THEN 100 ELSE GREATEST(45, progress - 5) END
     WHERE id = $1`,
    [project.id, input.type],
  );
  await touchClient(tx, project.client_id);

  if (input.type === 'approved') {
    // Advance the milestone chain: current -> complete, first upcoming -> current.
    await tx.query(
      `UPDATE milestones SET status = 'complete'
       WHERE id = (SELECT id FROM milestones WHERE project_id = $1 AND status = 'current'
                   ORDER BY position LIMIT 1)`,
      [project.id],
    );
    await tx.query(
      `UPDATE milestones SET status = 'current'
       WHERE id = (SELECT id FROM milestones WHERE project_id = $1 AND status = 'upcoming'
                   ORDER BY position LIMIT 1)`,
      [project.id],
    );
  }

  await addActivity(tx, {
    workspaceId: project.workspace_id, projectId: project.id, type: 'approval',
    title: input.type === 'approved' ? `${project.name} approved` : `Changes requested on ${project.name}`,
    detail: input.note || `Decision captured for revision ${revision.version}.`,
    actor: input.clientName,
  });
  await addNotification(tx, {
    workspaceId: project.workspace_id, projectId: project.id,
    title: input.type === 'approved' ? 'Client approval captured' : 'Client requested changes',
    body: `${input.clientName} responded to ${revision.label}.`,
  });
}
```

Import `DecisionType` from `../shared/types.js`.

- [x] **Step 2: Rewrite both decision routes**

```ts
app.post('/api/review/:token/decision', route(async (req, res) => {
  const input = decisionSchema.parse(req.body);
  let projectName = '';
  await repository.transaction(async (tx) => {
    const project = await requireProjectByToken(tx, req.params.token);
    projectName = project.name;
    await applyDecision(tx, project, input);
  });

  void notifySlack(
    input.type === 'approved'
      ? `✅ ${projectName} was approved by ${input.clientName}.`
      : `↩️ ${input.clientName} requested changes on ${projectName}.`,
  ).catch(console.error);

  res.status(201).json(await repository.readReviewPayload(req.params.token));
}));

app.post('/api/projects/:id/decision', route(async (req, res) => {
  const input = decisionSchema.parse(req.body);
  let projectName = '';
  const state = await mutate(async (tx) => {
    const project = await requireProject(tx, req.params.id);
    projectName = project.name;
    await applyDecision(tx, project, input);
  });

  void notifySlack(
    input.type === 'approved'
      ? `✅ ${projectName} was approved by ${input.clientName}.`
      : `↩️ ${input.clientName} requested changes on ${projectName}.`,
  ).catch(console.error);

  res.status(201).json(state);
}));
```

- [x] **Step 3: Rewrite the read-only routes**

```ts
app.get('/api/health', route(async (_req, res) => {
  const state = await repository.read(workspaceId);
  res.json({
    ok: true, app: 'Pind', mode: repository.mode,
    projects: state.projects.length, integrations: integrationFlags(repository.mode),
  });
}));

app.get('/api/bootstrap', route(async (_req, res) => {
  const state = await repository.read(workspaceId);
  state.integrations = integrationFlags(repository.mode);
  res.json({ state, meta: { repository: repository.mode, generatedAt: nowIso() } });
}));

app.get('/api/review/:token', route(async (req, res) => {
  const payload = await repository.readReviewPayload(req.params.token);
  if (!payload) {
    const error = new Error('Review link not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  res.json(payload);
}));
```

Delete `findProject`, `findReviewProject`, and `toReviewPayload` — all three are now dead.

- [x] **Step 4: Rewrite invite, settings, notifications, and reset**

```ts
app.post('/api/projects/:id/invite', route(async (req, res) => {
  const input = inviteSchema.parse(req.body);
  const state = await repository.read(workspaceId);
  const project = state.projects.find((item) => item.id === req.params.id);
  if (!project) {
    const error = new Error('Project not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const reviewUrl = `${appUrl(req)}/review/${project.reviewToken}`;
  const safeWorkspaceName = escapeHtml(state.workspace.name);
  const safeProjectName = escapeHtml(project.name);
  const safeMessage = escapeHtml(input.message || `Please review the latest revision of ${project.name}.`);
  const result = await sendEmail({
    to: input.email,
    subject: `Review ${project.name.replace(/[\r\n]/g, ' ')} in Pind`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1f2421">
        <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#66706a">${safeWorkspaceName}</div>
        <h1 style="font-size:28px;line-height:1.2;margin:18px 0 12px">Your review is ready</h1>
        <p style="line-height:1.6;color:#59615c">${safeMessage}</p>
        <a href="${reviewUrl}" style="display:inline-block;margin-top:18px;background:${state.workspace.accent};color:white;text-decoration:none;padding:13px 18px;border-radius:10px">Open review</a>
        <p style="margin-top:28px;font-size:12px;color:#8a918d">This secure link is scoped to ${safeProjectName}.</p>
      </div>`,
  });

  const updated = await mutate(async (tx) => {
    await addActivity(tx, {
      workspaceId, projectId: project.id, type: 'invite',
      title: `Review invitation ${result.sent ? 'sent' : 'prepared'}`,
      detail: `${input.email} was invited to review ${project.name}.`, actor: 'Maya Okeke',
    });
  });

  res.json({ state: updated, sent: result.sent, reviewUrl });
}));

app.patch('/api/settings', route(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const state = await mutate(async (tx) => {
    await tx.query(
      `UPDATE workspaces SET name=$2, short_name=$3, logo_text=$4, accent=$5, surface=$6,
         portal_headline=$7, approval_disclaimer=$8, email_from_name=$9,
         require_client_name=$10, allow_downloads=$11, show_revision_history=$12, updated_at=NOW()
       WHERE id = $1`,
      [workspaceId, input.name, input.shortName, input.logoText, input.accent, input.surface,
       input.portalHeadline, input.approvalDisclaimer, input.emailFromName,
       input.requireClientName, input.allowDownloads, input.showRevisionHistory],
    );
    await addActivity(tx, {
      workspaceId, type: 'project', title: 'Workspace branding updated',
      detail: `The client portal now uses ${input.name} branding.`, actor: 'Maya Okeke',
    });
  });
  res.json(state);
}));

app.patch('/api/notifications/:id/read', route(async (req, res) => {
  const state = await mutate(async (tx) => {
    await tx.query(`UPDATE notifications SET read = TRUE WHERE id = $1 AND workspace_id = $2`,
      [req.params.id, workspaceId]);
  });
  res.json(state);
}));

app.post('/api/demo/reset', route(async (_req, res) => {
  const state = await repository.reset(workspaceId);
  state.integrations = integrationFlags(repository.mode);
  res.json(state);
}));
```

- [x] **Step 5: Typecheck**

Run: `npm run check`
Expected: clean, with no remaining references to `updateState`, `findProject`, `findReviewProject`, or `toReviewPayload`.

Verify: `grep -n "updateState\|writeQueue\|findReviewProject\|toReviewPayload" server/index.ts` returns nothing.

- [x] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat(db): move decision, invite, settings and reset routes onto transactions"
```

---

### Task 9: Boot sequence, error mapping, docs, and end-to-end verification

**Files:**
- Modify: `server/index.ts` (boot, error middleware)
- Modify: `.env.example`, `README.md`, `replit.md`, `.replit`

**Interfaces:**
- Consumes: everything above.
- Produces: a running application backed by PostgreSQL.

- [x] **Step 1: Map Postgres error codes in the error middleware**

Insert before the generic `message`/`status` lines in the existing handler:

```ts
  // Postgres constraint violations carry the product's HTTP semantics.
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: string }).code);
    if (code === '23505') {
      return res.status(409).json({ error: 'A client with this email already exists' });
    }
    if (code === '23503') {
      return res.status(400).json({ error: 'Referenced record does not exist' });
    }
    if (code === '23514') {
      return res.status(400).json({ error: 'Invalid value for one of the fields' });
    }
  }
```

- [x] **Step 2: Replace the boot sequence at the bottom of `server/index.ts`**

```ts
async function start(): Promise<void> {
  try {
    const pool = getPool();
    await runMigrations(pool);
    const { inserted } = await seedWorkspace(pool);
    if (inserted) console.log('Seeded the Northstar demo workspace.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Pind server running on http://0.0.0.0:${port} (postgres)`);
  });
}

await start();
```

Add imports: `getPool` from `./db/pool.js`, `runMigrations` from `./db/migrate.js`, `seedWorkspace` from `./db/seed.js`. Delete the old bare `app.listen(...)` call.

- [x] **Step 3: Update `.env.example`**

Replace the `DATABASE_URL` block:

```
# REQUIRED. Pind stores everything in PostgreSQL.
#   Replit: open the Database tool and click Create — DATABASE_URL is injected.
#   Local:  createdb pind
DATABASE_URL=postgres://localhost:5432/pind

# Set to true only if your provider presents a certificate chain Node cannot
# verify. Leave unset otherwise — it disables TLS verification.
DATABASE_SSL_NO_VERIFY=

# Used by the test suite; created automatically if absent.
TEST_DATABASE_URL=postgres://localhost:5432/pind_test
```

- [x] **Step 4: Update the README setup section**

Under "Local development", before `npm run dev`:

````markdown
Pind requires PostgreSQL. On Replit, open the Database tool and click Create —
`DATABASE_URL` is injected automatically. Locally:

```bash
createdb pind
export DATABASE_URL=postgres://localhost:5432/pind
```

The server runs migrations and seeds the Northstar demo workspace on boot, so
no manual step is needed. To reseed by hand:

```bash
npm run db:migrate   # apply pending migrations
npm run db:seed      # idempotent; safe to run repeatedly
npm run db:reset     # wipe and re-seed the demo workspace
```
````

- [x] **Step 5: Run the whole suite**

```bash
npm run check
npm test
npm run build
```

Expected: typecheck clean; all tests pass; build succeeds.

- [x] **Step 6: Verify migrations and seed from a genuinely empty database**

```bash
dropdb --if-exists pind_verify && createdb pind_verify
DATABASE_URL=postgres://localhost:5432/pind_verify PORT=5100 npm start &
sleep 6
curl -s localhost:5100/api/health
psql -d pind_verify -c "SELECT COUNT(*) FROM projects;"
```

Expected: health reports `"mode":"postgres"` and `"projects":4`; the table holds 4 rows. This proves migrate-and-seed-on-boot works with no manual setup.

- [x] **Step 7: Drive every workflow end to end**

With the dev server running against `pind_verify`, exercise each workflow and
confirm rows land in Postgres after each one:

| Workflow | Request | Postgres check |
|---|---|---|
| Create client | `POST /api/clients` | `SELECT COUNT(*) FROM clients` → 5 |
| Duplicate client | same payload again | HTTP 409, count still 5 |
| Create project | `POST /api/projects` | `projects` +1, `review_tokens` +1, `milestones` +2 |
| Upload revision | `POST /api/projects/:id/revisions` | `revisions` +1 with `version = MAX+1` |
| Post comment | `POST /api/review/:token/comments` | `comments` +1, `author_role='client'` |
| Resolve comment | `PATCH /api/comments/:id/resolve` | `status='resolved'`, `resolved_at` set |
| Request changes | `POST /api/review/:token/decision` | `decisions` +1, project `status='changes-requested'` |
| Approve | `POST /api/review/:token/decision` | project `status='approved'`, `progress=100`, milestone advanced |
| Receipt | read the decision | `receipt_code` matches `^PND-[A-Z]*-[A-Z0-9]{6}$` |
| Reset demo | `POST /api/demo/reset` | counts return to 4 projects / 4 clients / 5 comments |

- [x] **Step 8: Verify every route in a browser, dev and production**

Load each of `/`, `/app`, `/app/projects`, `/app/projects/:id`, `/app/clients`,
`/app/activity`, `/app/settings`, `/design-system`, `/review/:token` directly,
and hard-refresh a deep route in production. Confirm no console errors and that
seeded data renders.

- [x] **Step 9: Confirm the fail-fast path**

```bash
env -u DATABASE_URL npm start
```

Expected: exits non-zero printing the three-line setup message; no server starts.

- [x] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(db): migrate and seed on boot, map pg errors, document setup"
```
