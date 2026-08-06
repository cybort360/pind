# Remix checklist

## First run

- [ ] Run the Repl and confirm `/api/health` returns `ok: true`.
- [ ] Open `/app` and verify four seeded projects appear.
- [ ] Open the Ember Coffee review link and add a test comment.
- [ ] Reset sample data after testing.

## Brand the template

- [ ] Change workspace name and short name.
- [ ] Replace logo letters.
- [ ] Choose an accent colour and surface mood.
- [ ] Edit the client portal headline.
- [ ] Review the approval disclaimer.
- [ ] Replace seeded artwork under `public/assets` when preparing a real deployment.

## Connect services

- [ ] Add `DATABASE_URL` for durable state.
- [ ] Add `RESEND_API_KEY` and a verified `EMAIL_FROM` address.
- [ ] Add Cloudinary credentials for durable file delivery.
- [ ] Add `SLACK_WEBHOOK_URL` when the team wants decision notifications.
- [ ] Set `APP_URL` to the published Replit URL.

## Before production use

- [ ] Add studio authentication.
- [ ] Add tenant-level authorisation if more than one studio shares the deployment.
- [ ] Rotate demo review tokens.
- [ ] Confirm file retention and deletion policy.
- [ ] Configure a real sender domain in Resend.
- [ ] Restrict CORS to the published application origin.
- [ ] Add monitoring and database backups.

## Before publishing as a template

- [ ] Keep `.env.example`, but never include real credentials.
- [ ] Reset the Northstar seed state.
- [ ] Confirm all pages work at desktop and mobile widths.
- [ ] Record a concise demo video.
- [ ] Include screenshots of the review canvas, receipt, settings, and design system.
- [ ] Confirm the README tells a remixer what works before credentials are added.
