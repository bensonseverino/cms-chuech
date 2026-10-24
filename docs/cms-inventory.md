# CMS Inventory: Existing Content Mapped to Spec Records

**Source repo:** `https://github.com/bensonseverino/chuech-public` (branch `main`)
**Site working copy:** `C:\Users\HomePC\Desktop\chuech studio\website\my-project`
**CMS working copy (this workspace):** `C:\Users\HomePC\Desktop\chuech studio\cms`
**Inspection date:** 2026-10-12 (verified 2026-10-12)

> **Workspace reality (read this first).** The site and the CMS live in **two sibling folders**, not one repo:
> - `website/my-project` — the Marino site (git repo, remote `bensonseverino/chuech-public`, HEAD `f1d2de8`). This is the repo the whole inventory below describes.
> - `cms/` — *this* workspace. It currently holds only `docs/` and a blank Vite scaffold at `my-project/` (React 19 + TS + Tailwind v4, no router/content).
>
> The spec's Phase 2 layout (`functions/`, `cms/`, `packages/`, `migrations/`, `scripts/` in one repo) therefore does **not** map onto the current folders. Phase 6 (public API + form intake) must ship inside the **site** project, so the two folders have to be reconciled before Phase 2. This is raised in §7/§9 and needs an owner decision.

---

## 1. Repository Overview

| Aspect | Finding |
|--------|---------|
| Framework | React 19 + TypeScript + Vite 8 |
| Router | `react-router` v8 (data router via `createBrowserRouter`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite` plugin) |
| Font | Plus Jakarta Sans Variable (`@fontsource-variable/plus-jakarta-sans`) |
| Animations | GSAP 3.15 + Lenis (smooth scroll) |
| Content location | `src/content/*.ts` (TypeScript modules) |
| Media location | `src/assets/marino/*.svg` (local placeholders) |
| Cloudflare Pages | **Not configured** (no `wrangler.toml`, no `functions/`) |
| R2 bucket | **Not used** (media is local) |
| D1 / KV | **Not used** |
| Forms | `src/lib/leads.ts` posts to `VITE_LEAD_ENDPOINT` (unset) |

---

## 2. Content Modules → Spec Record Mapping

### 2.1 Singleton Documents (section 2.1 "doc" types)

| Spec Record | Existing Module | Status | Notes |
|-------------|-----------------|--------|-------|
| `_site` (site settings) | **Missing** | ⚠️ New | Company details, SEO defaults, social links currently hard-coded in `SiteHeader`, `SiteFooter`, `home.ts` |
| `_navigation` | **Partial** in `src/routes.ts` + `SiteHeader` | ⚠️ Split | Routes defined in `routes.ts`; header renders nav + dropdowns from hard-coded JSX |
| `_footer` | `home.ts` → `FOOTER` const | ✅ Mapped | Full footer content in `home.ts` |
| `_home` | `home.ts` (multiple exports) | ✅ Mapped | Hero, intro, latest work, stats, insights, case study, FAQ, founder block |
| `_services` (services index) | `services.ts` → `SERVICES_HERO`, `PAGE_SERVICES`, `SERVICES_INTRO`, `SERVICES_WORK_INTRO` | ✅ Mapped | Hero + services rows + intro statement + latest work intro |
| `_work` (work index) | `projects.ts` → `WORK_PAGE_SIZE` + `PROJECTS` | ✅ Mapped | Hero defined in `WorkPage.tsx` (hard-coded), paging from `WORK_PAGE_SIZE` (13) |
| Service pages (`service_page` type) | `src/content/services/*.ts` | ✅ Mapped | `web-design.ts`, `branding.ts`, `seo.ts` — each exports `WEB_DESIGN`, `BRANDING`, `SEO` matching `ServicePageContent` shape |
| Generic pages (`page` type) | **Missing** | ⚠️ New | Privacy, Terms, About, Culture — routes exist in `routes.ts` but fall to `NotFoundPage` |

### 2.2 Collections (section 2.1 "collection" types)

| Spec Collection | Existing Module | Status | Notes |
|-----------------|-----------------|--------|-------|
| `services` | `home.ts` → `SERVICES` array | ✅ Mapped | 5 services: Branding, Web Design, SEO, PPC, Video. Used on Home + Services page. |
| `projects` | `projects.ts` → `PROJECTS` array | ✅ Mapped | 13 real + 14 placeholder entries. Tags match service titles. |
| `testimonials` | `home.ts` → `TESTIMONIALS` array | ✅ Mapped | 6 testimonials with quote/name/company. |
| `clients` | `ClientLogoStrip.tsx` → hard-coded `MARQUEE_LOGOS` | ⚠️ Restructure | Data exists but is hard-coded in the component, not a content module: 9 wordmarks (emap, WR Partners, Hard Rock Cafe, ISTOBAL, LEONARDO Hotels, HITACHI, Haines Watts, VISLINK, AP NUT) rendered as **styled text, not logo images** (`TODO(asset)` on the file). Needs extraction to a `clients` collection + real logo SVGs. |
| `articles` | `home.ts` → `ARTICLES` array | ✅ Partial | 4 articles with title/date/excerpt/categories/image. No markdown `body` or `readTime`. |

### 2.3 Forms Registry

| Spec Form Source | Existing Usage | Status |
|------------------|----------------|--------|
| `web-design-hero` | `WEB_DESIGN.hero.form.source` | ✅ Defined |
| `web-design-callback` | `WEB_DESIGN.why.form.source` | ✅ Defined |
| `branding-hero` | `BRANDING.hero.form.source` | ✅ Defined |
| `branding-callback` | `BRANDING.why.form.source` | ✅ Defined |
| `seo-hero` | `SEO.hero.form.source` | ✅ Defined |
| `seo-callback` | `SEO.why.form.source` | ✅ Defined |
| `contact` | `FOOTER.contact.href` → `/contact` (NotFoundPage) | ⚠️ Route exists, no form component |

**Note:** The `leads.ts` submit function uses `source` field but no central registry exists.

### 2.4 Media Library

| Spec Field | Existing Approach |
|------------|-------------------|
| Asset references | `assets.ts` slots → local imported SVGs |
| R2 integration | **None** — all media is local |
| Public domain | **None** |
| Focus points | `focus` string on services/projects (e.g., `'70% 25%'`) |
| Posters | **None** (no video content yet) |
| Alt text | Missing on most; `ProjectCard` uses empty alt, `imageAlt` on service pages |

---

## 3. Gaps vs. Spec Section 2.1

### 3.1 Missing Entirely (must be created)

| Record | Spec Section | Priority |
|--------|--------------|----------|
| `_site` (company, SEO defaults, social) | 2.1 | High |
| `_navigation` (structured menu + CTA) | 2.1 | High |
| `clients` collection | 2.1 | Medium |
| `articles` collection — add `body` (markdown), `readTime`, `slug` | 2.1 | Medium |
| `forms` registry table | 2.1 | High |
| Generic `page` docs (Privacy, Terms, About, Culture) | 2.1 | Low |
| Service pages for PPC, Video, AI SEO | 2.1 | Low |

### 3.2 Partial / Needs Restructuring

| Record | Current State | Work Needed |
|--------|---------------|-------------|
| `_home` | Split across multiple exports in `home.ts` | Consolidate into single `HomeDoc` shape per spec |
| `_services` | Split across `services.ts` exports | Consolidate into `ServicesIndexDoc` |
| `_work` | Hero hard-coded in `WorkPage.tsx`; projects in `projects.ts` | Extract hero to data; keep projects |
| `services` collection | In `home.ts` | Extract to own source; add `sort`, `showOnHome`, `pageSlug` |
| `projects` collection | In `projects.ts` | Add `slug`, `summary`, `body`, `gallery`, `featured`, `wideImage`, `cardFocus` |
| `testimonials` | In `home.ts` | Extract; add `sort` |
| `articles` | In `home.ts` | Extract; add `slug`, `body` (markdown), `readTime`, `sort` |

### 3.3 Spec Records Not in Current Site

| Spec Record | Where It Appears | Action |
|-------------|------------------|--------|
| `caseStudy` (on Home) | Home page spec §5.8 | Already in `home.ts` as `CASE_STUDY` — map to `_home` |
| `stats` (Experience section) | Home page spec §5.5 | Already in `home.ts` as `EXPERIENCE_MARQUEE`, `EXPERIENCE_PILLS` — map to `_home.stats` |
| `insights` (Home) | Home page spec §5.7 | Already in `home.ts` as `INSIGHTS`, `ARTICLES` — map to `_home.insights` |
| `faq` (Home) | Home page spec §5.9 | Already in `home.ts` as `FAQ_ITEMS` — map to `_home.faq` |
| `founderBlock` (Home) | Home page spec §5.9 | Already in `home.ts` as `FOUNDER_BLOCK` — map to `_home` |

---

## 4. R2 Bucket Status

| Question | Answer |
|----------|--------|
| Existing bucket name? | **None** — no R2 usage in repo |
| Public domain configured? | **No** |
| Current key naming? | N/A — local files via `assets.ts` slots |
| Media assets to migrate | ~30 SVG placeholders in `src/assets/marino/` + any future uploads |

**Action required:** Owner must create/provide R2 bucket name and confirm `media.<domain>` setup (Phase 1 steps 1–4).

---

## 5. Conflicts with Spec Section 2

| Spec Assumption | Reality | Resolution |
|-----------------|---------|------------|
| Site already on Cloudflare Pages | Not configured | Phase 1 must include initial Pages project setup for both site + CMS |
| Existing R2 bucket shared with site | No R2 usage | Owner creates bucket; Phase 8 import migrates local assets |
| Forms already posting to endpoint | `VITE_LEAD_ENDPOINT` unset | Phase 6 builds `/api/forms/:source`; Phase 10 updates `ContactForm` |
| `clients` collection exists on Home/Services | Not in codebase | Create empty collection; owner adds logos later |
| Blog/article detail pages exist | Routes in `routes.ts` but 404 | CMS supports content; site integration (Phase 10) adds routes later |

---

## 6. Rich Text Convention Compliance (Spec §2.3)

| Feature | Current Implementation | Spec Compliant? |
|---------|------------------------|-----------------|
| `**bold**` | Not used | ❌ |
| `==highlight==` (lavender pill) | Not used — highlights are separate `highlights` arrays | ❌ |
| `[text](/path)` links | `RichSegment[]` with `{label, href}` objects | ✅ Equivalent |
| Blank line = paragraph | Not used — paragraphs are separate array items | ❌ |
| Markdown for articles | Not used — `excerpt` only, no `body` | ❌ |

**Migration needed:** Seed script must convert current structured data to spec's rich text format.

---

## 7. Conflicts raised with the owner (Phase 0 Done-when)

The spec's opening assumption — *"Already done by the owner: the site is connected to Cloudflare Pages"* — and its fixed architecture rows do not match the repo. Per Phase 0, these are raised **before coding**:

| # | Spec says | Repo reality | Impact |
|---|---|---|---|
| C1 | Site already on Cloudflare Pages | **No `wrangler.toml`, no `functions/` anywhere.** Pages is not configured in the repo. | Phase 1 must set up Pages for both projects, not just the CMS; Phase 2 step 4 must author `wrangler.toml` from scratch (no dashboard settings to copy). |
| C2 | "The existing R2 bucket" shared by both projects | **No R2 usage at all.** Media is ~30 local SVGs under `src/assets/marino/` via the `assets.ts` slot map. | There is no bucket to share yet. Owner creates it; Phase 8's `import-existing` has nothing to import, and Phase 10's seed uploads the local placeholders instead. |
| C3 | CMS lives at `cms/` inside the site repo | Two sibling folders; this workspace (`cms/`) is separate from the site repo (`website/my-project`). | **Blocking Phase 2.** The layout must be reconciled (see §9 decision A). |
| C4 | Forms already post to an endpoint | `src/lib/leads.ts` posts to `VITE_LEAD_ENDPOINT`, which is **unset** — it logs and resolves. | Phase 6 builds `/api/forms/:source`; Phase 10 rewrites `submitLead`/`ContactForm`. Nothing to migrate. |
| C5 | `clients` collection exists on Home + Services | Data exists only as hard-coded text wordmarks in `ClientLogoStrip.tsx` (no logo images). | Create the collection; owner supplies real logo files. |
| C6 | Rich text uses `**bold**` / `==highlight==` / blank-line paragraphs | Not used. Content uses typed structures: `RichSegment = string \| {label, href}` and separate `highlights` arrays. | Seed must convert to the spec grammar; site components (`RichText.tsx`) change when the data layer lands (Phase 10). |
| C7 | Article/page `body` is markdown | `ARTICLES` have `excerpt` only — no `body`, no `readTime`. | Fields added by the CMS; content authored later. |

Also missing from the repo but required by the spec: `_site` (company/SEO/social), `_navigation` (structured), KV/D1 (all), generic `page` docs, and service pages for PPC/Video/AI-SEO (assets exist — `service-ppc.svg`, `service-video.svg` — but no content modules).

> Note: the design-system `@theme` token block the spec's §5.3 step 3 refers to **already exists verbatim** in the site at `src/index.css` (`--color-primary #82ffcd`, `--color-secondary #e2cbff`, `--color-obsidian #231f20`, `--color-fog #f3f3f3`, `--color-silver #c1c1c1`, `--radius-*`, `--shadow-glow-*`, `--ease-standard`). Copy those values into the CMS `tokens.css` rather than re-deriving them from `marino-design-system-enforcement.md`.

---

## 8. Phase 0 Done Checklist

- [x] Repo inspected: framework, router, Tailwind version, content location, media location, existing Functions, R2 usage, domain names, branch setup
- [x] This inventory written and verified against the live repo (`docs/cms-inventory.md`)
- [x] Conflicts with spec section 2 identified and documented above
- [x] **Conflicts raised with the owner** (§7) — awaiting the Phase 1/2 decisions in §9

---

## 9. Decisions needed before Phase 2 (owner)

| # | Decision | Options |
|---|---|---|
| A | **Where the CMS lives** | (1) Turn the site repo `website/my-project` into the spec's monorepo (`functions/`, `cms/`, `packages/`, `migrations/`, `scripts/`) and build everything there — cleanest for Phase 6, but edits the live site repo. (2) Build the CMS app + shared packages in *this* `cms/` workspace and have the site repo consume the shared packages — keeps the site repo untouched but needs a workspace link/sync. (3) Merge the two folders into one new monorepo. |
| B | **Cloudflare account specifics** | Domain (`<domain>`, `cms.<domain>`, `media.<domain>`), R2 bucket name, owner `ADMIN_EMAIL` / `ADMIN_PASSWORD`, Turnstile site/secret keys, editor emails/roles. |
| C | **Presigned uploads** | Needed only for videos > 50 MB (`aws4fetch` + R2 S3 keys + bucket CORS). Otherwise skip. |
| D | **Notification email** | Send via Resend (`RESEND_API_KEY` + `NOTIFY_FROM`) or leave the dashboard badge only. |
| E | **Retention / consent** | 24-month purge default, and whether a consent line is added to site forms (the one visual change to the site). |
| F | **Blog / project detail pages** | Build soon (CMS already supports the content) or later. |

---

## 10. Next Steps (Phase 1)

1. Owner reviews §7 conflicts and answers §9 decision A (layout) + B (Cloudflare specifics).
2. Agent delivers `docs/cloudflare-setup.md` — exact owner steps and verification commands (written; see that file).
3. Owner executes the Cloudflare steps and supplies D1/KV ids, the owner login, Turnstile keys, `media.<domain>`.
4. Agent proceeds to Phase 2 (repo structure + CMS project) once decision A is made.