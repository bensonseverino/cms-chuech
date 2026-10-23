# Marino CMS

Admin site, shared packages and the site-side integration for the Marino CMS —
Cloudflare Pages + D1 + R2 + KV, per `marino-cms-spec.md`.

The **public site** lives in a separate folder, `../website/my-project`
(git: `bensonseverino/chuech-public`). This repo holds everything else, including
the drop-in artefacts the site repo needs (`site-integration/`). That split is
decision A in [`docs/cms-inventory.md`](docs/cms-inventory.md#9-decisions-needed-before-phase-2-owner).

## Layout

```
functions/              Pages Functions for the admin project (Access-protected; _middleware lands in Phase 7)
admin/                  Pages project: marino-cms  (React + TS + Tailwind v4 SPA)
  src/components/       AdminShell — black sidebar, mint active state
  src/screens/          dashboard + routed screens (bodies land in Phase 9)
  src/styles/tokens.css the design tokens, copied verbatim from the spec
  wrangler.toml         bindings DB / MEDIA / CACHE + variables
packages/
  content-schema/       zod schemas, FieldDef catalog, RichInline grammar, validation
  api-kit/              responses, parseBody, resolveMedia, content cache, audit, Access auth
migrations/             D1 SQL, applied once to the shared database
site-integration/       drop-in for the site repo (wrangler.toml, public/_routes.json)
docs/
  cms-inventory.md      Phase 0: what exists today, mapped to spec records + conflicts
  cloudflare-setup.md   Phase 1: the owner's Cloudflare steps and verification commands
```

## Commands

Requires Node.js 22.22.0 or newer (`.nvmrc` pins it for the Cloudflare Pages build).

```bash
npm install

# apps
npm run dev:admin          # admin SPA only, hot reload on :5174
npm run dev:cms            # full admin: built SPA + Pages Functions (wrangler pages dev)

# checks
npm run typecheck          # tsc -b across all three workspaces
npm test                   # schema + grammar + seed-gate tests
npm run build              # build every workspace

# database (local first, always)
npm run db:migrate:local   # apply migrations to the local D1
npm run db:migrations:list # what is pending
npm run db:migrate:preview # apply to the preview D1 (needs real ids)
npm run db:migrate:prod    # apply to production  (needs real ids)

# operations
npm run db:time-travel     # D1 restore points
npx wrangler pages secret put <NAME> --project-name marino-cms
npx wrangler r2 object put marino-media/<key> --file <path>   # seed uploads
```

`dev:cms` generates a git-ignored `wrangler.toml` at the repo root from
`admin/wrangler.toml`, because Wrangler only discovers a Pages config in the
directory it runs from and always serves `./functions`. Edit the file in
`admin/`, not the generated one. `db:migrate:*` point at `admin/wrangler.toml`,
which owns the bindings for both projects. The site repo gets its own copy from
`site-integration/`.

## Status

| Phase | State |
|---|---|
| 0 Discovery | **done** — inventory verified against the real repo; seven conflicts raised (§7) |
| 1 Cloudflare resources | **owner-blocked** — exact steps written in [`docs/cloudflare-setup.md`](docs/cloudflare-setup.md); needs ids, Access + Turnstile keys and the domain |
| 2 Repo structure + CMS project | **done** — builds, runs under `wrangler pages dev`, bound to local D1/R2/KV |
| 3 Database | **done** — migrations apply cleanly; 9 tables, 7 form sources seeded |
| 4 Content schema | **done** — 13 record types + catalogs; 54 tests, including the seed gate |
| 5 Shared server kit | **done** — responses, validation hand-off, media, versioning, cache, audit, Access auth |
| 6 Public API + form intake | not started (lives in the site repo) |
| 7–11 | not started |

### What is unverified

Everything in Phases 2–5 was exercised **locally** (`wrangler pages dev` with
local D1/R2/KV persistence): `/api/admin/health` returns `ok: true` for all three
bindings, the SPA is served, and deep links fall back to it. Nothing has been
deployed, and no Cloudflare resource has been created — the placeholder ids in
`admin/wrangler.toml` are literal `<…>` strings until Phase 1 is completed.

Schema-level page parity (§8.3) is **not** proven: the seed-gate tests show which
existing content the schemas accept today, and they pin the two gaps that
block publishing Home and Work (see below).

## Deviations from the spec

1. **Two repos, not one.** The spec's Phase 2 tree (`functions/`, `cms/`,
   `packages/`, `migrations/`, `scripts/` in the site repo) is realised here as
   this repo, with the site-side pieces delivered as drop-ins in
   `site-integration/`. Phase 6 must ship inside the site project.
2. **The admin app directory is `admin/`, not `cms/`.** The repo root is already
   named `cms`, so `cms/cms/` would be the alternative. The Pages project name
   is still `marino-cms`; it builds from the repo root (output `admin/dist`) and
   Functions live in `functions/` at the root.
3. **`platform` bindings are declared in `packages/api-kit/src/types.ts`**
   instead of importing `@cloudflare/workers-types`, whose generated types
   reshuffle between majors.
4. **`service_page.projects.slugs` is an added field.** The live service pages
   curate their carousel order explicitly; a tag filter alone cannot reproduce
   it, which §8.3 requires.
5. **`_home.founder` is an added group.** The site renders a founder block on
   the home page today; it is not in the spec's §2.1 list but must be editable
   for parity.
6. **SEO keywords are stored as `{ label, to? }`.** The site's
   `string | { label, href }` is normalised by the seed; the stored shape follows
   the spec.
7. **`0002_seed_forms.sql` also seeds `seo-hero` / `seo-callback`.** The spec
   lists four sources plus `contact`; the repo ships a built SEO page that posts
   two more.

## Two content gaps the seed must close

Both are asserted in `packages/content-schema/src/seed-gate.test.ts`, so they
cannot be forgotten:

1. **The Home hero and the `/work` hero copy is in JSX**, not `src/content`
   (`HeroHeadline.tsx`, `WorkPage.tsx`), as is the home intro statement.
   Publishing Home reports `hero.description` and `introStatement.text`; Work
   reports `hero.title`.
2. **`clients` has no logo files.** The strip renders styled text wordmarks, and
   `logo` is required to publish a client. Real SVGs/PNGs are an owner input.
