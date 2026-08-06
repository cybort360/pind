# Pind

**Put feedback where the work is.**

Pind is a white-label client review, revision, approval, and delivery workspace for freelancers, studios, and agencies. It is built as a remixable Replit template: the first run contains a realistic fictional studio, four projects, revisions, pinned comments, milestones, notifications, and an approval receipt.

## Why this template exists

Creative work is routinely split across cloud drives, email threads, chat messages, and calls. Pind keeps the file, feedback, response, decision, and timestamp attached to the exact revision being discussed.

The template supports two distinct experiences:

- **Studio workspace:** projects, clients, revisions, comments, milestones, activity, settings, and integration status.
- **Project-scoped client portal:** a review-token URL that exposes only one project, lets a client pin feedback, and captures approval or requested changes.

## Buildathon qualification map

| Requirement | Pind implementation |
| --- | --- |
| Rich and interactive | Marketing site, dashboard, project index, project workspace with four tabs, client directory, activity log, settings, public review portal, approval receipt, modals, notifications, filters, uploads, and responsive layouts. |
| Connected | PostgreSQL persistence, Cloudinary uploads, Resend invitations, and Slack decision notifications. Each integration is detected from environment variables. |
| Well-designed | A complete editorial design system, responsive interface, empty/loading/error states, realistic assets, four seeded projects, and a dedicated `/design-system` route. |
| Genuinely useful | A freelancer or agency can remix the template, change branding, connect credentials, add clients and projects, upload revisions, collect feedback, and retain sign-off records. |

## Quick start on Replit

1. Remix the template.
2. Click **Run**. Pind works immediately in file-backed demo mode.
3. Open `/app` for the studio workspace.
4. Open the seeded **Summer Packaging Redesign** project and choose **Client view**.
5. Add environment variables from `.env.example` when you want persistent database storage, email, cloud file storage, or Slack notifications.
6. Publish from the Replit workspace.

## Local development

```bash
npm install
npm run dev
```

Everything is served from a single public port, `PORT` (default `5000`, injected by Replit).

- **Development** — Vite serves the interface on `PORT` and proxies `/api` and `/uploads` to the Express API, which listens privately on `API_PORT` (default `3001`).
- **Production** — Express listens on `PORT` and serves both the built client and the API.

Both bind to `0.0.0.0`. Override the port when something else already holds it, e.g. macOS AirPlay on 5000:

```bash
PORT=5100 npm run dev
```

Production build:

```bash
npm run check
npm test
npm run build
npm start
```

## Integrations

All integrations are optional-by-configuration. The application remains fully explorable without credentials.

| Integration | Environment variables | Fallback |
| --- | --- | --- |
| PostgreSQL / Replit Database | `DATABASE_URL` | JSON state in `.data/pind.json` |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | Review URL is copied instead of sending email |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Files are stored under `/uploads` |
| Slack | `SLACK_WEBHOOK_URL` | Decision is stored without a team notification |

Set `APP_URL` to the published application URL so email invitations contain the correct review link.

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Product and template landing page |
| `/app` | Studio overview |
| `/app/projects` | Searchable project index |
| `/app/projects/:projectId` | Review, overview, files, and timeline workspace |
| `/app/clients` | Client directory and active work |
| `/app/activity` | Searchable audit trail |
| `/app/settings` | Branding, portal behaviour, and integration status |
| `/review/:token` | Project-scoped client review portal |
| `/design-system` | Tokens and reusable UI patterns |

## Seeded demo

The default workspace is **Northstar Creative**. The primary demo project is **Summer Packaging Redesign** for **Ember Coffee**, containing:

- Three visual revisions.
- Two resolved comments with studio responses.
- One open pinned comment.
- Four milestones.
- A ready-to-use review link.

Additional projects demonstrate requested changes, draft work, and an approved project with a decision receipt.

Reset the sample workspace from **Settings → Reset sample data** or run:

```bash
npm run seed
```

## Security and data boundaries

- Public review URLs call project-scoped API routes and do not bootstrap the complete studio workspace.
- Uploads are limited to 25 MB and filenames are sanitised before local storage.
- API requests are rate-limited and standard security headers are enabled.
- Request payloads are validated with Zod.
- New review tokens use a long random suffix.

The published Buildathon demo intentionally leaves the studio workspace explorable. Before using Pind for confidential production work, add studio authentication and tenant-level authorisation. The client token boundary is already separated so an authentication provider can be added without redesigning the review workflow.

## Template structure

```text
pind/
├── public/assets/          # Seeded visual deliverables
├── server/
│   ├── index.ts            # API, uploads, review routes, deployment server
│   ├── integrations.ts     # Cloudinary, Resend, Slack
│   ├── repository.ts       # PostgreSQL or file repository
│   ├── seed-data.ts        # Realistic first-run workspace
│   └── validation.ts       # Zod request contracts
├── shared/types.ts         # Shared domain model
├── src/
│   ├── components/         # Reusable interface patterns
│   ├── pages/              # Product screens
│   ├── state.tsx           # App state and toasts
│   └── styles.css          # Tokens and full responsive design system
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEMO_SCRIPT.md
│   ├── QA_CHECKLIST.md
│   ├── REMIX_CHECKLIST.md
│   └── SUBMISSION.md
└── replit.md               # Replit Agent project context
```

## Useful template extensions

The clearest next additions are studio authentication, per-workspace tenancy, video timeline comments, PDF page annotations, payment milestones, and signed final-file delivery. The current domain model and repository boundary are designed so these can be added without replacing the client review experience.

## License

MIT. The seeded company names and artwork are fictional and included for demonstration.
