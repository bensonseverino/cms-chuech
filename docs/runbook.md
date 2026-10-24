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
npx wrangler pages secret put ADMIN_PASSWORD --project-name cms2chuech
npx wrangler pages secret list --project-name cms2chuech   # names only
```

`ADMIN_PASSWORD` is the only credential the admin hostname has (there is no
Cloudflare Access check any more). Rotating it needs two steps: update the
secret, then re-seed so D1 holds the new hash —
`npm run db:seed-admin:remote`. Session cookies issued before the rotation stay
valid until they expire; delete the `sessions` rows to cut them off immediately.

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

1. **CMS → Users → Invite user** — choose `viewer`, `editor` or `admin`. This is
   the role the API checks on every request.
2. Give that person a password: the invite creates the `users` row, and the
   owner sets/resets the password from the same screen (or seeds the owner with
   `npm run db:seed-admin:remote`).

Reaching the admin hostname is not enough — a request with no valid
`cms_session` is a 401 and an inactive `users` row is a 403 by design.
Deactivating the CMS row takes effect on the next request.

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
ENV=development
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=...
AUTO_LOGIN=true      # optional
```

`npm run db:seed-admin` writes the matching password hash into local D1. The
development allowances (`/api/auth/dev-auto-login`, the loopback Origin
mismatch for mutations) require `ENV=development` **and** a loopback hostname;
neither is active on a real hostname.

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
2. `npx wrangler login` or export a scoped `CLOUDFLARE_API_TOKEN`, then run
   `npm run cf:wire -- --discover` (or pass `--d1/--d1-preview/--kv/--kv-preview`
   directly). It writes the D1, KV and R2 ids into **both** `admin/wrangler.toml`
   and `site-integration/wrangler.toml`, regenerates the local root config, and
   exits non-zero if any `<...>` placeholder survives. A placeholder
   `database_id` binds no database at all, so every login 500s at
   `env.DB.prepare(...)`.
3. Confirm the production origins (`SITE_ORIGIN`, `CMS_ORIGIN`,
   `MEDIA_PUBLIC_BASE`) are real values, not `example.com`. `cf:wire` fills them
   when the same variables are exported.
4. Apply migrations before deploying code that expects them:
   `npm run db:migrate:prod`, then seed the owner login against the remote
   database: `npm run db:seed-admin:remote` (reads `ADMIN_EMAIL` /
   `ADMIN_PASSWORD`; it refuses to run while the config is unwired).

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
npm run smoke:login -- --url https://cms2chuech.pages.dev
```

It signs in with the seeded owner account and asserts login 200, the
`cms_session` cookie, `/api/admin/me` 200 with the user and capabilities, and
`/api/admin/health` 200 — the same sequence the SPA runs on boot. Add
`--expect-failure` to confirm a wrong password is rejected with 401.

The individual requests are still useful when something fails:

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
- `https://cms2chuech.pages.dev` was verified on 2026-10-24: `/api/admin/health`
  returns JSON with D1, R2 and KV all reachable; password login returns 200 with
  a `cms_session` cookie; `/api/admin/me` returns the admin user and 9
  capabilities; a wrong password returns 401; and a mutation without
  `X-Requested-With` returns 403.
- Provisioned resources: D1 `marino-cms` (prod) and `marino-cms-preview` (the
  `preview_database_id` of the `DB` binding, not a separately named database),
  KV `CACHE` + `CACHE_preview`, and R2 `marino-media`. Their ids are wired into
  `admin/wrangler.toml` and `site-integration/wrangler.toml`.
- The Pages project carries those bindings and the variables `CMS_ORIGIN`,
  `SITE_ORIGIN` and `MEDIA_PUBLIC_BASE` in both the production and preview
  deployment configs, plus the `ADMIN_PASSWORD` secret.
- `MEDIA_PUBLIC_BASE` is set to `https://chuechstudio.co.ke/media`; confirm that
  this is where the public site actually serves `/media` before relying on
  image URLs in the admin.
- `cms2chuech` is Git-connected: a push to `master` builds and deploys on its
  own. `wrangler pages deploy` is only needed to ship a bundle that is not on
  `master` yet, or to pick up bindings without waiting for a build.
- Cloudflare auth expires periodically; run `npx wrangler login` interactively
  before remote work.

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
