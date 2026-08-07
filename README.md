# Pind

**Put feedback where the work is.**

Pind is a white-label client review, revision, approval, and delivery workspace for freelancers, studios, and agencies. It ships as a remixable Replit template: on first run it walks you through creating your own workspace, and you can open the Northstar demo to see the full flow pre-loaded with four projects, revisions, pinned comments, milestones, notifications, and an approval receipt.

## What it does

Creative work is routinely split across cloud drives, email threads, and chat messages. Pind keeps the file, feedback, response, decision, and timestamp attached to the exact revision being discussed.

The template supports two experiences:

- **Studio workspace** — projects, clients, revisions, comments, milestones, activity, branding, settings, and integration status. Protected by the owner's sign-in session.
- **Project-scoped client portal** — a review-token URL exposes exactly one project, lets a client pin feedback on the artwork, and captures approval or requested changes. No account required.

## Quick start on Replit

1. **Remix** the template.
2. Open the **Database** tool and click **Create**. That injects `DATABASE_URL`, the one required variable.
3. Click **Run**. The server connects to Postgres, applies migrations, and starts.
4. Open the app. The first run shows a **Create your workspace** screen — enter your studio name, owner name, email, and password.
5. Tick **Load the sample data** to open the Northstar demo alongside your workspace, or use **Explore the demo first** to take one-click tour.
6. Add optional variables from `.env.example` for email, cloud file storage, or Slack notifications.
7. Publish from the Replit workspace.

> The demo workspace is reset to its original content from **Settings → Reset sample data** at any time.

## First run and demo mode

- The very first request records your workspace and password. Every subsequent boot skips setup and asks you to sign in.
- **Demo mode** is a one-click escape hatch (`Explore the demo` on the auth screens). It opens the pre-seeded Northstar workspace, so a visiting reviewer never needs your owner password. Demo sessions are isolated from real workspaces.
- Sign out from the workspace menu (bottom-left, beside your name).
- The demo workspace can always be reset from **Settings → Reset sample data**, restoring the original seeded clients, projects, and review links.

## Local development

```bash
npm install
```

Pind requires PostgreSQL. On Replit, open the Database tool and click Create — `DATABASE_URL` is injected automatically. Locally:

```bash
createdb pind
export DATABASE_URL=postgres://localhost:5432/pind
```

Migrations run automatically on boot, so no manual step is needed.

```bash
npm run dev
```

Both bind to `0.0.0.0`. Override the ports when something else already holds them, e.g. macOS AirPlay on 5000:

```bash
PORT=5100 npm run dev
```

Production:

```bash
npm run check   # TypeScript, client and server
npm test        # full automated suite (59 tests)
npm run build   # client + server + bundled migrations
npm start
```

## Configuration

All runtime configuration is deliberate, documented, and optional.

### Product-level configuration (`shared/config.ts`)

The app name, tagline, description, project categories, deliverable kinds, and the approval wording are centralised in `shared/config.ts` and served to both the server and the client through `GET /api/config`. Change them once and every screen follows.

### Environment variables (`.env.example`)

Copy `.env.example` to `.env` and fill in your own values. Everything except `DATABASE_URL` is optional, and the app stays fully explorable without it.

| Variable | Purpose | Fallback when unset |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (Replit injects it) | **Required** — the server exits at boot without it |
| `DATABASE_SSL_NO_VERIFY` | Disable TLS verification only when needed | Verification unchanged |
| `TEST_DATABASE_URL` | Test suite database (created automatically) | not used outside tests |
| `RESEND_API_KEY`, `EMAIL_FROM` | Invitation and approval emails | Review URL is copied instead of emailed |
| `CLOUDINARY_CLOUD_NAME`, `API_KEY`, `API_SECRET` | Cloud file storage | Files stored under `/uploads` |
| `SLACK_WEBHOOK_URL` | Team notification on a decision | Decision stored without a Slack post |
| `APP_URL` | Published URL for invite links; also locks CORS | Derived from each request |
| `PORT` | Public port (Replit injects it) | `5000` |
| `API_PORT` | Private dev API port | `3001` |
| `SESSION_TTL_DAYS` | Signed-in session length | `30` |
| `FEATURE_*` | Deploy-time feature flags | See `featureFlags()` |

No secrets are ever committed. `.env.example` contains variable names only.

### Feature flags

`GET /api/config` returns the same flags the server uses, so the client can enable or disable UI accordingly. Example:

```bash
FEATURE_REQUIRE_CLIENT_NAME=false FEATURE_ALLOW_DOWNLOADS=false FEATURE_SHOW_REVISION_HISTORY=true
```

## Integrations

| Integration | Environment variables | Fallback |
| --- | --- | --- |
| PostgreSQL / Replit Database | `DATABASE_URL` | **Required** —
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | Review URL copied instead of email |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Files stored under `/uploads` |
| Slack | `SLACK_WEBHOOK_URL` | Decision stored without a team notification |

Set `APP_URL` to the published URL so emailed review links point at the right host.

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Product and template landing page |
| `/setup` | First-run workspace creation (auto-redirects after setup) |
| `/login` | Sign in to your workspace |
| `/app` | Studio overview |
| `/app/projects` | Searchable project index |
| `/app/projects/:projectId` | Review, overview, files, and timeline workspace |
| `/app/clients` | Client directory and active work |
| `/app/activity` | Searchable audit trail |
| `/app/settings` | Branding, portal behaviour, integrations, and demo reset |
| `/review/:token` | Project-scoped client review portal (no account) |
| `/design-system` | Tokens and reusable UI patterns |
| `*` | Useful 404 page |

## Seeded demo

The default demo workspace is **Northstar Creative**. The primary demo project is **Summer Packaging Redesign** for **Ember Coffee**:

- Three visual revisions.
- Two resolved comments with studio responses.
- One open pinned comment.
- Four milestones.
- A ready-to-use, revocable review link.

Additional projects demonstrate requested changes, draft work, and an approved project with a decision receipt. Reset it from **Settings** or `npm run db:reset`.

## Security and data boundaries

- **First run only** — workspace creation and owner sign-in are password-protected; there is no default or hard-coded password.
- **Tenant isolation** — every studied route verifies the project belongs to the authenticated workspace before mutating. A cross-workspace project ID returns `404`.
- **Session security** — passwords are hashed with scrypt; session tokens are stored as SHA-256 hashes, not raw values, and are httpOnly.
- **Revocable review links** — tokens can be rotated or revoked from the project workspace; a revoked or expired link returns `404` for both viewing and decisions.
- **Public review boundary** — public review URLs call project-scoped routes and never bootstrap the full studio workspace.
- **Upload restrictions** — 25 MB limit, MIME whitelist, and blocked file extensions (`.html`, `.svg`, `.js`, `.exe`, and more).
- **Safety** — API rate limiting, Content-Security-Policy via Helmet, CORS locked to `APP_URL` when set, and all request payloads validated with Zod.

## Template structure

```text
pind/
├── public/assets/          # Seeded visual deliverables
├── server/
│   ├── db/                 # Pool, migrations runner, seed, row mapping, writes
│   ├── migrations/         # Versioned SQL schema migrations
│   ├── index.ts            # Bootstrap: load env, start the server
│   ├── app.ts              # Express app factory (createApp) — all routes, auth, uploads
│   ├── auth.ts             # scrypt hashing, session tokens, secure cookies
│   ├── integrations.ts     # Cloudinary, Resend, Slack
│   ├── repository.ts       # PostgreSQL repository boundary (injectable for tests)
│   ├── seed-data.ts        # Fictional first-run workspace
│   └── validation.ts       # Zod request contracts
├── shared/
│   ├── config.ts           # App name, categories, kinds, wording, feature flags
│   └── types.ts            # Shared domain model
├── src/
│   ├── components/         # Reusable interface patterns
│   ├── pages/              # Product screens (incl. Setup, Login, 404)
│   ├── state.tsx           # App state, auth flow, and toasts
│   └── styles.css          # Design tokens and responsive system
├── tests/                  # Unit + HTTP integration suites
│   ├── http.test.ts        # Auth, tenancy, review tokens, uploads, validation
│   └── ...
├── docs/                   # Architecture, demo script, remix checklists, submission
└── replit.md               # Replit Agent project context
```

## Testing

```bash
npm test
```

The suite covers the migration runner, the pool and TLS handling, repository assembly, seed consistency, request validation, and a full end-to-end HTTP layer (setup, login/logout, session expiry, workspace isolation, demo reset, review-token rotation and revocation, and mutation authorization). Tests run against `TEST_DATABASE_URL`, never your development database.

## License

MIT. The seeded company names and artwork are fictional and included for demonstration.