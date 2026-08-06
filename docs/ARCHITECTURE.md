# Pind architecture

## Product boundary

Pind separates the internal studio workspace from project-scoped client review links.

```text
Studio browser                       Client browser
      │                                    │
      ├── /api/bootstrap                   ├── /api/review/:token
      ├── /api/projects/*                  ├── /api/review/:token/comments
      ├── /api/comments/*                  └── /api/review/:token/decision
      └── /api/settings                          │
                    │                            │
                    └──────── Express API ──────┘
                                  │
                    Repository interface
                       ├── PostgreSQL JSONB row
                       └── Local JSON demo file
                                  │
                    Optional adapters
                       ├── Cloudinary
                       ├── Resend
                       └── Slack webhook
```

The public review API returns only:

- The project identified by the token.
- The workspace branding needed to render the portal.
- The client attached to that project.

It never returns the full projects, clients, notifications, or activity collections.

## Domain model

The top-level `AppState` contains:

- `workspace`: white-label settings and portal policy.
- `clients`: studio-side client directory.
- `projects`: revisions, comments, milestones, and decisions.
- `activities`: chronological audit trail.
- `notifications`: studio attention items.
- `integrations`: capability flags derived from environment configuration.

A `Decision` always references a `Revision`. This is the core invariant behind an approval receipt: the client approves a specific file and version rather than an abstract project state.

## Repository strategy

`createRepository()` chooses an implementation at startup:

- `DATABASE_URL` present → `PostgresRepository`.
- No database URL → `FileRepository`.

Both implement the same `read`, `write`, and `reset` contract. The PostgreSQL version stores the complete demo state as JSONB in one row. That keeps the template understandable and makes remixing painless. A production SaaS can replace this adapter with normalised multi-tenant tables without changing page-level API contracts.

Writes are serialised through an in-process queue to prevent two mutations from overwriting each other inside one application instance.

## Integration behaviour

### Cloudinary

Uploaded files are sent to Cloudinary when all three Cloudinary credentials exist. Otherwise, the file is stored locally. The API returns the same revision shape in both modes.

### Resend

The invitation endpoint creates the review URL in all modes. With a Resend key, it sends a branded email. Without a key, it reports `sent: false`; the interface copies the URL and explains the missing configuration.

### Slack

Approval and change-request decisions optionally post to a webhook. Slack failure does not roll back the persisted client decision.

## Deployment

Development starts Vite and the API concurrently. Vite proxies API and upload requests.

Production runs in two stages:

1. Vite builds the browser application into `dist`.
2. TypeScript compiles the API into `dist-server`.

Express serves `dist`, uploaded fallback files, and API routes from the same origin.

## Production hardening path

Before confidential multi-client deployment:

1. Add Replit Auth or another OIDC provider to studio routes.
2. Introduce `workspaceId` and tenant-aware repository queries.
3. Store review-token hashes rather than plaintext tokens.
4. Add token rotation and expiry.
5. Move local fallback uploads to durable object storage.
6. Add malware scanning and explicit MIME allowlists.
7. Add database transactions or optimistic version checks for horizontally scaled instances.
8. Create immutable decision/audit tables rather than mutable JSON state.
