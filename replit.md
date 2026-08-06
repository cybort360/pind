# Pind project context

Pind is a white-label client review, feedback, approval, and delivery template.

## Non-negotiable product rules
- Keep the public demo seeded and explorable.
- Every mutation must persist through the repository adapter.
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
