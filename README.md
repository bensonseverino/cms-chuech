# Chuech CMS

Admin API and SPA for the Chuech Studio website. The CMS runs on Cloudflare
Pages with D1, R2 and KV, and shares its content database, media bucket and
cache namespace with the public site. Internal package names remain `@marino/*`;
the visible product is **Chuech CMS**.

The public site lives in `../website/my-project`
(git: `bensonseverino/chuech-public`). This repo owns the admin application, the
Pages Functions behind `/api/admin/*`, the shared schema/API packages, and the
site-side integration notes. The public read API and fixed-shape form intake
remain in the site repo and are not rebuilt here.

## Layout

```text
functions/api/admin/       Session-protected admin Pages Functions
admin/                     React + TypeScript + Tailwind v4 SPA
packages/content-schema/   Zod schemas, FieldDef catalog, rich-inline grammar
packages/api-kit/          Responses, validation, media, cache, audit, roles
migrations/                Shared D1 schema and form-source seeds
scripts/                   Local setup + idempotent Chuech content seed
site-integration/          Drop-in bindings/routes for the public site
docs/                      Setup, inventory and operating runbook
```

The admin project is `cms2chuech`. It builds from the repo root with output
`admin/dist`; Pages Functions live in `functions/` at the root. The only branch
is `master`. Node `>=22.22.0` is required.

## Commands

```bash
npm install

# local development
npm run db:migrate:local       # apply migrations to local D1
npm run seed:chuech            # seed Chuech content + media into local D1/R2
npm run dev:cms                # Pages Functions + built SPA on :8788
npm run dev:admin              # Vite SPA on :5174, proxying /api to :8788

# checks
npm run typecheck              # admin, Functions, api-kit and content-schema
npm test                       # 54 schema/grammar/seed-gate tests
npm run build                  # production build (admin output: admin/dist)

# remote operations (require real Cloudflare ids and `wrangler login`)
npm run cf:wire -- --discover           # write real D1/KV/R2 ids into both wrangler.toml files
npm run db:migrate:preview
npm run db:migrate:prod
npm run seed:chuech:remote
npm run db:seed-admin:remote            # create/refresh the owner login in remote D1
npm run smoke:login -- --url https://cms2chuech.pages.dev
```

`cf:wire` accepts either a scoped token (`CLOUDFLARE_API_TOKEN`, optional
`CLOUDFLARE_ACCOUNT_ID`) to look the resources up by name, or pasted ids:
`--d1 <id> --d1-preview <id> --kv <id> --kv-preview <id>`. It fails if a
placeholder is left behind, because an unwired `database_id` is what makes
login return 500 in production. `smoke:login` then runs the real
login → `/api/admin/me` → `/api/admin/health` sequence the SPA performs.

`dev:cms` generates a git-ignored root `wrangler.toml` from
`admin/wrangler.toml`; always edit the config in `admin/`. The Vite dev server
proxies `/api` to `http://127.0.0.1:8788`.

## Authentication

One identity source: the fixed owner credentials. `npm run db:seed-admin`
hashes `ADMIN_EMAIL` / `ADMIN_PASSWORD` into the owner's `users` row, and
`POST /api/auth/login` checks a submitted password against that hash and issues
the `cms_session` cookie. Every `/api/admin/*` request re-checks that session
against D1; there is no Cloudflare Access JWT verification and no trusted
header path.

Local development reads `.dev.vars` at the repo root, which is git-ignored:

```dotenv
ENV=development
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=...
AUTO_LOGIN=true      # optional: /login signs in on load
```

`ENV=development` unlocks two loopback-only allowances: `/api/auth/dev-auto-login`
and the Vite-proxy Origin mismatch (`:5174` → `:8788`) for mutations. Both are
inert on a real hostname.

Because the password is the only door, keep it long and unique, set it as a
Cloudflare secret (`wrangler pages secret put ADMIN_PASSWORD`) and rotate it by
re-running `npm run db:seed-admin:remote`.

## Roles

| Capability | Viewer | Editor | Admin |
|---|---|---|---|
| Read documents/entries/media/inbox | yes | yes | yes |
| Edit and publish content, upload media | no | yes | yes |
| Delete content, manage forms/settings/users, export CSV, view audit | no | no | yes |

Settings singletons `_site`, `_navigation` and `_footer` are admin-only.
`_home`, `_services`, `_work` and service pages are editor-editable. Every API
request re-checks the role from D1; hiding UI is presentation only.

Admin mutations require both a matching `Origin` and
`X-Requested-With: XMLHttpRequest`. Publishing copies `data` to
`published_data` and increments `content_version`; saves use optimistic locking
through `expectedVersion`.

## Seeding

`scripts/seed-chuech.mjs` reads canonical content from
`../../website/my-project/src` (override with `CHUECH_SITE_ROOT`) and:

- uploads the site SVGs plus generated client wordmark placeholders to
  `uploads/YYYY/MM/chuech-seed/`;
- upserts nine documents and 37 published entries: 5 services, 13 projects,
  6 testimonials, 9 clients, 4 articles;
- validates each record at publish level before writing it;
- is rerunnable. It owns the records it seeds, overwrites their content on each
  run, increments their versions, and bumps `content_version`.

Seed content is deliberately not a migration. A schema migration is a
one-time structural change; site copy belongs in the site repo and can be
re-seeded without inventing a rollback path. The local `/about` record remains a
non-seed fixture for testing generic pages.

Only three service-page documents are created because only Branding, Web
Design and SEO exist as page modules in the source site. PPC and Video remain
services entries. Client logo source files do not exist, so the seed generates
SVG wordmarks preserving all nine names.

## Deployment state

The production Pages project exists at
`https://cms2chuech.pages.dev`, but the deployed Functions route has not yet
been verified: `/api/admin/health` currently returns the SPA fallback rather
than JSON. The account also needs confirmation of the D1, R2 and KV bindings and the
production origins, plus the owner `ADMIN_PASSWORD` secret.

> **Privacy Policy note**: The Privacy Policy published on the website should
> mention that form submissions are collected and stored in the CMS inbox, and
> that visitors' data (name, email, message, etc.) is retained per the retention
> policy. See the `submissions` table and `site_settings.notifications` for
> details on data handling.

`admin/wrangler.toml` names the Pages project `cms2chuech`; its resource ids,
resource names and origin variables still need the values already present in
Cloudflare. Cloudflare authentication in this environment has expired, so the
remote deploy and the production health/API checks remain owner actions. See
[`docs/runbook.md`](docs/runbook.md#8-deploy-and-verify) and
[`docs/cloudflare-setup.md`](docs/cloudflare-setup.md).
