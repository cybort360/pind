# Pind — PostgreSQL persistence layer (Cycle 1)

**Date:** 2026-08-06
**Status:** Approved
**Scope:** Cycle 1 of 3. Replaces Pind's single-JSONB-document storage with a
relational PostgreSQL schema, migrations, and an idempotent seed.

## Context

Pind currently stores its entire application state as one JSONB document in
`pind_app_state.payload`, or as a JSON file on disk when `DATABASE_URL` is
unset. Every mutation reads the whole document, mutates a JavaScript object,
and writes the whole document back. There are no foreign keys, no constraints,
and no transactions — writes are serialised through an in-process promise
queue (`writeQueue`) that only protects a single instance.

This is the "fake persistence" that has to go before authentication can
associate users with their own workspace.

## Sequencing

This work is the first of three cycles. Cycle 1 gates Cycle 2 because
workspace-scoped authentication needs a tenant-aware schema to attach to.

| Cycle | Subsystem | Status |
|---|---|---|
| 1 | PostgreSQL schema, migrations, idempotent seed | **this spec** |
| 2 | Replit Auth (OIDC), sessions, tenancy, route guards | not started |
| 3 | Cloudinary / Resend / Slack adapters | not started |

## Goals

1. Relational tables for workspaces, users, clients, projects, milestones,
   revisions, comments, notifications, review tokens, and approval decisions.
2. A reliable, repeatable schema initialisation process.
3. A seeded Northstar Creative demo workspace that does not duplicate when
   seeded repeatedly.
4. No remaining fake persistence in any important workflow.

## Non-goals

- Changing the HTTP API contract or any client-side code.
- Changing the visual design, routes, or product behaviour.
- Introducing an ORM. The existing hand-rolled `pg` style is preserved.
- Authentication, tenancy enforcement, or third-party integrations (Cycles 2–3).

## Approach

**Normalise storage, preserve the `AppState` API contract.**

`repository.read(workspaceId)` assembles an `AppState` object from relational
queries. Mutations become targeted SQL statements inside a real transaction.
Routes continue to return the assembled `AppState`, so the React frontend and
all nine routes are untouched.

Two approaches were rejected:

- *Narrow REST responses* — returning only affected entities would be faster
  over the wire but redesigns the API surface and every page's state handling.
- *JSONB with relational views* — smallest diff, but leaves the fake
  persistence in place and provides no real constraints.

### Storage engine

PostgreSQL becomes mandatory. `DATABASE_URL` is required; the JSON
`FileRepository` is deleted. Without it the server exits at boot with:

```
Pind requires a PostgreSQL database.
  On Replit: open the Database tool and click Create.
  Locally:   createdb pind && export DATABASE_URL=postgres://localhost:5432/pind
```

This removes the dual write path through every mutation.

## Schema

Twelve tables. All identifiers are `TEXT` natural keys matching the existing
seed IDs (`project-ember-packaging`, `rev-ember-1`), which is what makes the
seed idempotent. Enumerations use `CHECK` constraints rather than PostgreSQL
enum types, so future values can be added in a plain migration.

Every tenant-owned table carries `workspace_id` from the start, so Cycle 2 adds
only the user→workspace link rather than re-migrating every table.

### `workspaces`

Tenant root. Holds the white-label branding and client-portal settings that
`WorkspaceSettings` exposes.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name`, `short_name`, `logo_text` | TEXT NOT NULL | |
| `accent` | TEXT NOT NULL | `CHECK (accent ~ '^#[0-9A-Fa-f]{6}$')` |
| `surface` | TEXT NOT NULL | `CHECK (surface IN ('warm','cool','paper'))` |
| `portal_headline`, `approval_disclaimer`, `email_from_name` | TEXT NOT NULL | |
| `require_client_name`, `allow_downloads`, `show_revision_history` | BOOLEAN NOT NULL | |
| `created_at`, `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

### `users`

Created in Cycle 1, populated in Cycle 2. `id` is the Replit OIDC `sub`.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Replit OIDC subject |
| `workspace_id` | TEXT NOT NULL | FK → `workspaces` ON DELETE CASCADE |
| `email`, `first_name`, `last_name`, `profile_image_url` | TEXT NULL | from OIDC claims |
| `role` | TEXT NOT NULL DEFAULT `'owner'` | `CHECK (role IN ('owner','member'))` |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `last_login_at` | TIMESTAMPTZ NULL | |

Partial unique index on `lower(email)` where email is not null.

### `clients`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `workspace_id` | TEXT NOT NULL | FK → `workspaces` ON DELETE CASCADE |
| `name`, `company`, `email`, `avatar` | TEXT NOT NULL | |
| `last_active_at` | TIMESTAMPTZ NOT NULL | |
| `status` | TEXT NOT NULL | `CHECK (status IN ('active','invited','archived'))` |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

`UNIQUE (workspace_id, lower(email))` — enforces in the database the duplicate
check currently performed in JavaScript, which returns HTTP 409.

`Client.activeProjects` is **not stored**. It is derived at read time as
`COUNT(projects WHERE client_id = clients.id AND status <> 'approved')`.

### `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `workspace_id` | TEXT NOT NULL | FK → `workspaces` ON DELETE CASCADE |
| `client_id` | TEXT NOT NULL | FK → `clients` ON DELETE RESTRICT |
| `name`, `category`, `description`, `cover`, `owner` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL | `CHECK (status IN ('in-review','changes-requested','approved','draft'))` |
| `due_at`, `updated_at`, `created_at` | TIMESTAMPTZ NOT NULL | |
| `progress` | INTEGER NOT NULL DEFAULT 0 | `CHECK (progress BETWEEN 0 AND 100)` |
| `budget_label` | TEXT NOT NULL DEFAULT `'Not set'` | |

Indexes: `(workspace_id, updated_at DESC)`, `(client_id)`.

`Project.clientName` is **not stored**. It is derived by joining
`clients.company`.

### `milestones`

`id` PK, `project_id` FK ON DELETE CASCADE, `title` TEXT NOT NULL, `due_at`
TIMESTAMPTZ NOT NULL, `status` TEXT NOT NULL
`CHECK (status IN ('complete','current','upcoming'))`, `position` INTEGER NOT
NULL. Ordered by `position`. Index on `(project_id, position)`.

### `revisions`

`id` PK, `project_id` FK ON DELETE CASCADE, `label`, `file_name`, `file_url`,
`kind`, `uploaded_by`, `size_label`, `note` TEXT, `thumbnail` TEXT NULL,
`version` INTEGER NOT NULL, `uploaded_at` TIMESTAMPTZ NOT NULL.

- `CHECK (kind IN ('image','pdf','video','link','file'))`
- `UNIQUE (project_id, version)` — makes the "next version number" calculation
  race-safe. Today it is `Math.max(...versions) + 1` computed in JavaScript,
  which can collide under concurrent uploads.
- Index on `(project_id, version)`.

### `comments`

`id` PK, `project_id` FK ON DELETE CASCADE, `revision_id` FK → `revisions`
ON DELETE CASCADE, `author`, `body` TEXT NOT NULL, `author_role` TEXT NOT NULL
`CHECK (author_role IN ('client','studio'))`, `status` TEXT NOT NULL
`CHECK (status IN ('open','resolved'))`, `created_at` TIMESTAMPTZ NOT NULL,
`resolved_at` TIMESTAMPTZ NULL, `reply` TEXT NULL, `x` and `y` REAL NULL with
`CHECK (x BETWEEN 0 AND 100)` / `CHECK (y BETWEEN 0 AND 100)`.

Index on `(project_id, created_at DESC)`.

### `decisions`

`id` PK, `project_id` FK ON DELETE CASCADE, `revision_id` FK → `revisions`
ON DELETE RESTRICT, `type` TEXT NOT NULL
`CHECK (type IN ('approved','changes-requested'))`, `client_name`,
`client_email`, `note` TEXT NOT NULL, `created_at` TIMESTAMPTZ NOT NULL,
`receipt_code` TEXT NOT NULL UNIQUE.

An approval receipt is a legal-ish artefact, so `revision_id` uses ON DELETE
RESTRICT: a revision that has been decided on cannot be deleted.

### `review_tokens`

Promoted to its own table so Cycle 2 can revoke and expire links.

| Column | Type | Notes |
|---|---|---|
| `token` | TEXT PK | the secret |
| `project_id` | TEXT NOT NULL | FK → `projects` ON DELETE CASCADE |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `expires_at` | TIMESTAMPTZ NULL | NULL = no expiry |
| `revoked_at` | TIMESTAMPTZ NULL | |
| `last_used_at` | TIMESTAMPTZ NULL | |

`CREATE UNIQUE INDEX ON review_tokens (project_id) WHERE revoked_at IS NULL` —
at most one active token per project, which is what `Project.reviewToken`
exposes.

### `activities` and `notifications`

Both: `id` PK, `workspace_id` FK ON DELETE CASCADE, `project_id` FK NULL
ON DELETE CASCADE, `created_at` TIMESTAMPTZ NOT NULL.

- `activities` adds `type` TEXT NOT NULL
  `CHECK (type IN ('comment','upload','approval','invite','resolve','project'))`,
  `title`, `detail`, `actor` TEXT NOT NULL.
- `notifications` adds `title`, `body` TEXT NOT NULL, `read` BOOLEAN NOT NULL
  DEFAULT FALSE.

Both indexed on `(workspace_id, created_at DESC)`.

The current code truncates these lists to 100 and 50 items in JavaScript.
That behaviour is preserved by applying `LIMIT` at read time; rows are not
deleted.

### `schema_migrations`

`version` INTEGER PK, `name` TEXT NOT NULL, `applied_at` TIMESTAMPTZ NOT NULL
DEFAULT NOW().

## Migrations

Plain numbered SQL files in `server/migrations/`, applied by a small runner in
`server/migrate.ts`:

```
server/migrations/001_initial_schema.sql
```

Runner behaviour:

1. Acquire `pg_advisory_lock(<constant>)`. Replit autoscale can start several
   instances at once; without the lock they race to apply the same migration.
2. Ensure `schema_migrations` exists.
3. Read `*.sql` files, sort by numeric prefix, skip already-applied versions.
4. Apply each remaining file inside its own transaction, then record the row.
   A failure rolls that file back and aborts; earlier files stay applied.
5. Release the lock.

Migrations are forward-only. There are no down migrations — on Replit the
recovery path is to recreate the database and re-seed.

## Seeding

`server/seed-data.ts` keeps its current shape as the source of truth. A new
`server/seed.ts` writes it relationally:

- One transaction for the whole seed.
- Every insert is `INSERT … ON CONFLICT (id) DO NOTHING`, so re-running adds
  nothing. Running `npm run db:seed` three times produces identical row counts.
- Relative timestamps re-anchor to seed time, so the demo never reads as stale.
- The demo workspace id is `workspace-northstar`.

`POST /api/demo/reset` deletes rows for `workspace-northstar` only (cascades
handle children) and re-seeds inside one transaction. It cannot affect other
workspaces, which matters once Cycle 2 introduces real tenants.

Boot sequence: connect → advisory lock → migrate → seed if the workspace is
absent → listen.

## Repository interface

```ts
interface Repository {
  read(workspaceId: string): Promise<AppState>;
  readReviewPayload(token: string): Promise<ReviewPayload | null>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  reset(workspaceId: string): Promise<AppState>;
}
```

Pool lifecycle is owned by `server/db/pool.ts` (`getPool` / `closePool`) rather
than the repository, so the CLI entry points can close the pool without holding
a repository instance.

```
```

`readReviewPayload(token)` is new and important. Today the public review
endpoint calls `repository.read()` — loading the entire workspace — and then
filters in memory. The relational version queries only the token's project,
its client, and the workspace branding. No other project's data is ever
loaded, which is the query shape Cycle 2's "do not expose workspace-wide data
through public review endpoints" requirement depends on.

`updateState()` and the `writeQueue` promise chain are deleted. Each mutation
route runs its statements inside `repository.transaction()`, then re-reads and
returns the assembled `AppState` so the response contract is unchanged.

## Error handling

- Missing `DATABASE_URL`: exit at boot with the message above.
- Unreachable database at boot: log the connection error and exit non-zero, so
  Replit restarts rather than serving a broken app.
- Constraint violations map to existing HTTP semantics: unique violation on
  `clients` → 409 (`23505`), foreign-key violation → 400 (`23503`). These are
  translated in the existing Express error middleware.
- Transaction failures roll back; the request returns the mapped status. The
  async route wrapper added previously already routes rejections to the error
  handler.

## Testing

Against a real PostgreSQL database (`TEST_DATABASE_URL`, defaulting to
`postgres://localhost:5432/pind_test`):

1. `tests/migrate.test.ts` — migrations apply to an empty database; applying
   them a second time is a no-op; `schema_migrations` holds one row per file.
2. `tests/seed.test.ts` — the existing 4 assertions continue to pass against
   `seedState`; new assertions confirm seeding twice leaves row counts
   unchanged and that derived `activeProjects` matches the non-approved
   project count.
3. `tests/repository.test.ts` — assembled `AppState` round-trips; a client
   duplicate raises `23505`; `readReviewPayload` returns exactly one project
   and no others; a revoked token returns null.
4. `tests/validation.test.ts` — unchanged.

Tests that need a database create and migrate `pind_test` in a setup file and
truncate between cases.

## Verification

Beyond the test suite, the running application is driven end to end:
create a client, create a project, upload a revision, post a comment, request
changes, approve work, and generate a receipt — confirming each writes real
rows to PostgreSQL, and that all nine routes still load directly and survive a
refresh in both development and production.

## Migration of existing data

None. The JSONB `pind_app_state` table and the `.data/pind.json` file hold only
demo data that the seed reproduces. The initial migration drops
`pind_app_state` if present.
