# Runbook

Operational procedures for the Chuech CMS admin project (`cms2chuech`). The
public read API and form intake live in the public-site repo; this runbook covers
the admin database, media, forms, users, local development, seeding and deploy
verification.

---

## 1. Restore the database after a bad migration

There is deliberately no down-migration. A schema that may already hold content
should be restored point-in-time, not “undone” by a second script.

### 1a. D1 Time Travel (preview and production)

```bash
# Replace marino-cms with the database name configured in admin/wrangler.toml.
npx wrangler d1 time-travel info marino-cms
npx wrangler d1 time-travel info marino-cms-preview

npx wrangler d1 time-travel restore marino-cms --timestamp=1750000000
npx wrangler d1 time-travel restore marino-cms --bookmark=<bookmark>
```

The dashboard path is **Workers & Pages → D1 → database → Time Travel**.

Three cautions:

1. **It rewinds the whole database.** Submissions, status changes and audit rows
   written after the bookmark are also lost. Recover one submission through the
   inbox instead of rewinding for it.
2. **Take the bookmark before the risky change**, not after the damage.
3. **Export first** if you need anything after the restore point:
   `npx wrangler d1 export marino-cms --remote --output backup.sql`.

The admin API needs an authenticated Cloudflare session for all remote
operations. If Wrangler says the auth token expired, run `npx wrangler login` or
set `CLOUDFLARE_API_TOKEN`.

### 1b. Local reset (development)

Local D1/R2/KV live under `.wrangler/state` at the repo root. Local data is
disposable:

```bash
# PowerShell: Remove-Item -Recurse -Force .wrangler/state
rm -rf .wrangler/state
npm run db:migrate:local
npm run seed:chuech
```

### 1c. A faulty applied migration

Never edit an applied file — Wrangler tracks migrations by name and will not run
it again. Add a new numbered migration and apply that. Editing an applied
migration silently diverges local, preview and production.

---

## 2. Rotate a secret

Secrets are per Pages project and cannot be read back.

```bash
npx wrangler pages secret put CF_ACCESS_AUD --project-name cms2chuech
npx wrangler pages secret list --project-name cms2chuech   # names only
```

Redeploy after changing a secret. `PREVIEW_SECRET` rotation invalidates
outstanding preview links. `IP_HASH_SALT` rotation makes old submission hashes
non-comparable to new ones; that is acceptable because hashes are for abuse
correlation, never identity.

The 25-variable limit counts the same name in preview and production twice.

---

## 3. Add or change a form

Normal forms need no CMS code change and no migration.

1. Open **Forms** in the admin. This screen is admin-only.
2. Register the source with its label, enabled state, notification recipients and
   success message.
3. Render the site's shared form with that exact `source`.
4. The public intake accepts it immediately after the site is updated.

Publishing a `service_page` auto-registers `<slug>-hero` and
`<slug>-callback` (`auto_registered = 1`). The seven sources shipped today are
seeded by `migrations/0002_seed_forms.sql`.

Submissions are immutable evidence. Status and internal notes can change; a
submission can only be permanently deleted by an admin. Opening one marks it
read automatically; status and notes require explicit saves.

CSV export is admin-only and uses the same filters as the inbox. Every export is
written to the audit log.

---

## 4. Add a service page

1. In **Pages → New page → Service page**, use the URL slug (for example
   `ppc`), not the Services collection's internal slug.
2. Fill hero, feature, projects, pillars, why and FAQ.
3. Publish. A new service page needs no deploy: it becomes available through the
   public page API and the site's catch-all route.

`projects.tag` or `projects.slugs` drives the carousel. Tags must match a
project's `services[]` values, and those values must be existing service titles.

---

## 5. Add a CMS user

Both steps are required:

1. **Cloudflare Access → the Chuech CMS application → Policies** — add the
   person's email or identity-provider group. This lets them reach the admin
   hostname.
2. **CMS → Users → Invite user** — choose `viewer`, `editor` or `admin`. This is
   the role the API checks on every request.

Being in Access with no active `users` row is a 403 by design. Deactivating the
CMS row takes effect on the next request without changing Access.

`BOOTSTRAP_ADMIN_EMAIL` creates the first admin only while the `users` table is
empty; it is not a backdoor afterwards.

Role boundary:

- **Viewer** — read-only content, media and submissions.
- **Editor** — edit/publish content and upload media; no deletes, forms,
  settings, users, audit, or CSV export.
- **Admin** — everything, including `_site`, `_navigation` and `_footer`
  mutation, content deletion, user/form management and audit.

---

## 6. Local development

Requirements: Node `>=22.22.0` and an npm install at the repo root.

```bash
npm run db:migrate:local   # local D1 schema + form-source seeds
npm run seed:chuech        # local Chuech content and media
npm run dev:cms            # Pages Functions on 127.0.0.1:8788
npm run dev:admin          # Vite SPA, proxies /api to :8788
```

`dev:cms` generates a git-ignored root `wrangler.toml` from
`admin/wrangler.toml`. Edit the admin config, never the generated file.

Local auth uses `.dev.vars` at the repo root:

```dotenv
DEV_USER_EMAIL=owner@example.com
```

The bypass requires both that variable and a loopback hostname. Unknown emails
are rejected. Never set `DEV_USER_EMAIL` in Cloudflare.

Health check:

```bash
curl http://127.0.0.1:8788/api/admin/health
# {"ok":true,"bindings":{...},"mediaPublicBase":"https://media.example.com"}
```

The Vite SPA normally takes `:5174`; if that port is occupied it may choose
`:5175`. The API target remains `127.0.0.1:8788`.

Media thumbnails in the admin point at `MEDIA_PUBLIC_BASE`. The local default is
`https://media.example.com`, so R2 objects can exist and render as broken images
locally. Upload, metadata editing, usage checks and soft delete still work.

---

## 7. Seed the Chuech content

```bash
npm run seed:chuech          # local
npm run seed:chuech:remote   # remote; requires migrations and Cloudflare auth
```

The script reads canonical content from `../../website/my-project/src` by
default; override with `CHUECH_SITE_ROOT`.

It uploads 25 SVGs (16 site assets plus 9 generated client wordmark
placeholders) under `uploads/YYYY/MM/chuech-seed/`, then upserts:

- 9 documents: site settings, navigation, footer, home, services index, work
  index, and the Branding, Web Design and SEO service pages;
- 37 published entries: 5 services, 13 projects, 6 testimonials, 9 clients and
  4 articles.

Every record is validated at publish level before it is written. The seed is
idempotent for records it owns: rerunning overwrites their content, increments
record versions and bumps `content_version`.

Seed content is intentionally not a migration. Copy belongs to the site repo and
can be re-seeded without inventing a rollback path. The local `/about` record is
a non-seed fixture for generic-page testing and is left alone.

The seed does not use a transaction because `wrangler d1 execute --file` rejects
`BEGIN`/`COMMIT`. Every statement is an idempotent upsert, so a partial run can be
safely repeated.

Only three service pages exist because the source site has page modules for
Branding, Web Design and SEO. PPC and Video remain services entries.

---

## 8. Deploy and verify

### Before deploying

1. `npm run typecheck && npm test && npm run build`.
2. Confirm `admin/wrangler.toml` contains the **real** D1 ids/names, R2 bucket,
   KV ids, production origins and Access team domain. The project name is
   already `cms2chuech`; resource ids and origin variables still need the values
   from the Cloudflare account.
3. `npx wrangler login` or export a scoped `CLOUDFLARE_API_TOKEN`.
4. Apply migrations before deploying code that expects them:
   `npm run db:migrate:prod`.

### Deploy

From the repo root:

```bash
npm run build
npx wrangler pages deploy admin/dist --project-name cms2chuech
```

Pages Functions must be included from the repo-root `functions/` directory. If
the deploy summary does not list a Functions bundle, stop and fix the project’s
root/build configuration before treating the release as complete.

### Verify

```bash
curl -sS https://cms2chuech.pages.dev/api/admin/health
curl -sS https://cms2chuech.pages.dev/api/admin/me
```

Expected: health returns JSON with `"ok":true` and all three bindings reachable;
`/me` returns the signed-in role and capabilities. If `/api/admin/health`
returns the SPA’s HTML, Functions are not deployed or the request is falling
through to the static asset handler — redeploy with the Functions directory and
check the Pages build output.

Then verify the public site separately against the site project: published page
JSON, published collection entries, and one fixed-shape form POST. The admin
deploy does not deploy the public site.

### Current deployment state

- Local admin API, SPA, seed and role flows are verified.
- The production project exists at `https://cms2chuech.pages.dev`, but
  `/api/admin/health` currently returns SPA HTML, so the Functions route is not
  verified.
- Production D1/R2/KV bindings, Access team/AUD and the real media origin remain
  unconfirmed.
- Cloudflare auth in this environment is expired and the refresh token is
  invalid; run `npx wrangler login` interactively before remote work.

---

## 9. Backups, retention and recovery

- **D1:** use scheduled `npx wrangler d1 export <db> --remote --output …` plus
  Time Travel. Test a restore before relying on it.
- **R2:** object keys are immutable and uploads are never overwritten. Media
  deletes are soft deletes; the R2 object remains. Configure bucket lifecycle /
  backups outside this repo if the account requires them.
- **KV:** holds `content_version` and rate-limit counters, not durable content.
  A lost CACHE namespace can be recreated; publish once afterwards to repopulate
  the current version.
- **Submissions:** there is no automatic purge job. Archive before deleting.
  Deletes are permanent and require an admin.
- **Audit log:** append-only from the application’s perspective. It includes
  content writes, publish/unpublish/revert, media changes, user changes, form
  changes, submission status/bulk actions and CSV exports.
