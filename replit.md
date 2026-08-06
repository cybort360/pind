# Pind project context

Pind is a white-label client review, feedback, approval, and delivery template.

## Persistence
- PostgreSQL is required. Open the Database tool and click **Create**; Replit injects `DATABASE_URL`.
- The server applies migrations from `server/migrations/` and seeds the Northstar demo workspace on boot, so a fresh database needs no manual step.
- Without a reachable `DATABASE_URL` the server prints the setup message and exits non-zero rather than starting.
- Schema changes go in a new numbered file under `server/migrations/`; never edit an applied migration.

## Non-negotiable product rules
- Keep the public demo seeded and explorable.
- Every mutation must persist through the repository adapter, inside a transaction.
- Client review links must remain role-safe and scoped to one project. Public pages must use `/api/review/:token*`, never `/api/bootstrap`.
- Preserve the calm editorial design system; do not add generic neon gradients.
- New components must use tokens defined in `src/styles.css`.
- Real integrations are optional-by-configuration and must degrade gracefully.

## Main routes
- `/` marketing and template overview
- `/app` workspace dashboard
- `/app/projects` projects
- `/app/projects/:id` project workspace
- `/review/:token` client review portal
- `/app/clients` clients
- `/app/activity` activity log
- `/app/settings` branding and integrations
- `/design-system` reusable component library
