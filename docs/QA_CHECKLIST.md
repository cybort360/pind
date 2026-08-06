# Pind release QA

Run this checklist after remixing into Replit and before publishing the template.

## Automated gates

```bash
npm install
npm run check
npm test
npm run build
```

Then start the production server and confirm:

```bash
npm start
curl http://localhost:5000/api/health
```

The health response should report `ok: true`, the active repository mode, four seeded projects, and integration flags.

## Core studio workflow

- Open `/app` and confirm the seeded dashboard, metrics, projects, clients, and activity are populated.
- Create a client and verify it appears immediately in the directory.
- Create a project for that client and verify its review token is unique.
- Upload a safe image or PDF under 25 MB and verify the revision appears in Review and Files.
- Pin a studio comment, add a general comment, and resolve one with a response.
- Copy the client review link and open it in a private browser window.
- Search the workspace with `Cmd/Ctrl + K`.
- Test project search, status filters, category filters, sorting, grid view, and list view.

## Client workflow

- Open a project-scoped `/review/:token` URL.
- Switch between revisions and verify comments remain attached to the correct version.
- Pin feedback on the artwork and add a general note.
- Request changes and verify project status, activity, notification, and client last-active time update.
- Approve a revision and verify the exact revision, filename, reviewer, timestamp, note, and receipt code appear in the receipt.
- Print or save the receipt as PDF.
- Confirm the review API does not return unrelated projects, clients, notifications, or activity.

## Integration workflow

- With `DATABASE_URL` unset, verify the server exits with the setup message instead of starting.
- Against an empty database, verify the first boot applies migrations, seeds the demo workspace, and reports the database as connected in Settings.
- With no optional credentials, verify local uploads still work.
- Add Cloudinary credentials and verify a new revision stores a hosted URL.
- Add Resend credentials and a verified sender, then send a review invitation.
- Add `SLACK_WEBHOOK_URL`, capture a decision, and verify the team notification arrives.
- Set `APP_URL` to the published URL before testing invitations outside the Repl.

## Visual and responsive checks

- Review `/`, `/app`, `/app/projects`, one project, `/review/:token`, `/app/settings`, and `/design-system` at desktop width.
- Repeat at approximately 390 px mobile width.
- Confirm the sidebar, client feedback drawer, decision bar, dialogs, tables, and filters remain usable.
- Confirm seeded artwork loads, no page shows lorem ipsum, and empty states appear for a newly created project.
- Confirm workspace name, logo letters, accent, surface mood, portal headline, and policy toggles update the client experience.

## Submission assets

- Reset the Northstar Creative sample state.
- Publish the Repl.
- Record the 60–75 second flow in `docs/DEMO_SCRIPT.md`.
- Capture screenshots of the dashboard, pinned review canvas, client decision bar, receipt, settings, and design system.
- Paste the copy from `docs/SUBMISSION.md` into the challenge submission.
