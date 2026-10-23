# Cloudflare Setup — Marino CMS (Phase 1)

> **Who does what.** Steps marked **[Owner]** are Cloudflare dashboard/account actions with no repo-side equivalent — the agent cannot do them and cannot proceed past the blocks below without the values they return. **[Agent]** items are already done or will be done in the repo.
>
> **Read the two surprises first.** The spec's opening line ("the site is connected to Cloudflare Pages") and its "existing R2 bucket" do **not** match the repo:
> - **There is no `wrangler.toml` and no `functions/` anywhere** — Pages has never been configured from this repo. Step 10 creates *both* Pages projects.
> - **There is no R2 bucket.** Media is ~30 local SVGs under `src/assets/marino/` addressed through the `assets.ts` slot map. Step 1 creates the bucket; there is nothing existing to "share" or "import" yet.
>
> Confirmed by the Phase 0 inventory: [`cms-inventory.md`](cms-inventory.md).

---

## 0. Prerequisites

**[Owner]**

1. Install/verify Node 20+ and log in:
   ```bash
   npx wrangler --version      # expect v4.x
   npx wrangler login
   npx wrangler whoami         # confirms the account + id
   ```
2. Have the account id handy (`npx wrangler whoami` prints it) — needed for the R2 S3 credentials in §2's optional step and for the S3 credentials table.
3. Zone present in the same account with DNS control for `<domain>`.

> **Placeholders used throughout:** `<domain>`, `<team>` (Access team), and the bucket name. Decide these before starting (see the decisions list at the end of the inventory). Suggested bucket name: `marino-media`.

---

## 1. R2 bucket **[Owner]**

There is no existing bucket, so create one and treat it as the shared bucket for site + CMS.

```bash
# create (suggested name; anything works, just record it)
npx wrangler r2 bucket create marino-media

# confirm it exists
npx wrangler r2 bucket list
```

**Rules that hold for the whole project:**
- The site's own static assets are **not** moved here. The bucket holds CMS media only, under the key prefix `uploads/`. Nothing else is ever written to a top-level key.
- Objects are immutable: never overwrite a key. The CMS generates a new key per upload (`uploads/{YYYY}/{MM}/{id}-{slug}.{ext}`).

**Return to the agent:** the exact bucket name.

---

## 2. D1 databases **[Owner]**

Two databases — production and preview — so preview deployments never touch production rows.

```bash
npx wrangler d1 create marino-cms
npx wrangler d1 create marino-cms-preview
```

Each prints a `database_id`. **Send both ids to the agent** (they go into the `[[d1_databases]]` blocks as `database_id` and `preview_database_id`).

Verify:
```bash
npx wrangler d1 list
```

> **Never** point preview deployments at `marino-cms`. The spec's §9.1 note is explicit: previews use the preview D1 and KV.

---

## 3. KV namespaces **[Owner]**

Wrangler v3/v4 no longer has a `--preview` flag for `kv namespace create`; create **two** namespaces and wire the second in as `preview_id`.

```bash
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create CACHE --preview-name marino-cache-preview
```

The `CACHE` namespace holds `content_version` (the cache-busting counter) and the form rate-limit counters.

**Send both ids to the agent.** Verify:
```bash
npx wrangler kv namespace list
```

---

## 4. R2 public access — `media.<domain>` **[Owner]**

This is the public read path for every image/video; `MEDIA_PUBLIC_BASE` is set to it.

**Dashboard:** R2 → `marino-media` → **Settings** → **Public access** → **Custom Domains** → **Connect Domain** → enter `media.<domain>`.

- Cloudflare creates the CNAME automatically if the zone is in this account.
- Wait for the certificate/status to show **Active** before moving on.
- **Do not enable the `r2.dev` URL for production.** It is rate-limited and not for real traffic. (It is fine to leave it on temporarily while testing, but `MEDIA_PUBLIC_BASE` must be the custom domain.)

**Verification (must pass before Phase 1 is "Done"):** upload one throwaway object and fetch it over the custom domain:
```bash
echo "ok" > /tmp/r2-check.txt
npx wrangler r2 object put marino-media/_setup-check/r2-check.txt --file /tmp/r2-check.txt --content-type text/plain
curl -sSI "https://media.<domain>/_setup-check/r2-check.txt" | head -5     # expect HTTP/2 200
npx wrangler r2 object delete marino-media/_setup-check/r2-check.txt
```
`_setup-check/` is temporary; delete it after. Real content only ever lives under `uploads/`.

Unless a response header (Cache-Control, Content-Type, the SVG CSP below) is set per object, a custom domain serves files as-is — that is why the CMS sets `Cache-Control` and `Content-Type` at upload time.

**Return to the agent:** confirmation that `https://media.<domain>/…` returns 200.

---

## 5. R2 CORS — **only if presigned uploads are built** **[Owner]**

Skip this unless videos > 50 MB are required (spec §8.6). If presigned `PUT` is built, the CMS origin must be allowed to upload directly to the bucket:

**Dashboard:** R2 → `marino-media` → **Settings** → **CORS Policy** →
```json
[
  {
    "AllowedOrigins": ["https://cms.<domain>"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Also requires an R2 API token (**R2 → Manage R2 API Tokens → Create API Token**, Object Read & Write on this bucket) to give `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

---

## 6. Transform Rule — SVG response CSP **[Owner]**

Uploaded SVGs opened directly on `media.<domain>` must not be able to run script.

**Dashboard:** the zone → **Rules** → **Transform Rules** → **Modify Response Header** → **Create rule**:

- **Name:** `SVG CSP on media`
- **When incoming requests match — Custom filter expression:**
  ```
  http.host eq "media.<domain>" and http.request.uri.path.extension eq "svg"
  ```
- **Then — Set static:**
  - Header name: `Content-Security-Policy`
  - Value: `default-src 'none'; style-src 'unsafe-inline'; sandbox`

Note: response-header *Transform Rules* each own their header, so this rule adds the CSP without disturbing anything else. This is belt-and-braces with the app-side rule that SVGs are admin-only.

---

## 7. Cloudflare Access — protect `cms.<domain>` **[Owner]**

**Dashboard:** Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted**.

1. **Application name:** `Marino CMS`
2. **Session duration:** `24 hours`
3. **Public hostname:** `cms.<domain>` → path (leave blank).
4. **Add a second public hostname** for each Pages preview hostname pattern of the CMS project. Preview deployments get a random subdomain, so add `*.<cms-project>.pages.dev` (or the specific preview hostnames) — otherwise previews are wide open. Production `marino-cms` deployment hostnames can be added too if not covered by the custom domain.
5. **Access policies** → **Add a policy**:
   - Name: `Team`
   - Action: **Allow**
   - Include → **Emails** → list the team's editor emails, **or** Include → your identity provider group.
6. **Identity provider:** configure under Zero Trust → Settings → Authentication → Login methods (One-time PIN needs no setup; Google/Microsoft need OAuth credentials).
7. **Save.**

Then collect two values from the application:
- **Team domain:** Zero Trust → Settings → Custom Pages / or the dashboard URL — it looks like `<team>.cloudflareaccess.com`. The JWT issuer is `https://<team>.cloudflareaccess.com`.
- **Application Audience (AUD) tag:** open the application → **Overview** → scroll to **Application Audience (AUD) Tag** → copy. This becomes the `CF_ACCESS_AUD` secret.

The CMS API verifies `Cf-Access-Jwt-Assertion` (RS256, via `jose`) against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, checking `aud` = the AUD tag and `iss`. Access is the *front door*; the API re-checks every request regardless (spec §7).

**Return to the agent:** `<team>` team domain and the AUD tag.

---

## 8. Turnstile **[Owner]**

**Dashboard:** Turnstile → **Add widget**:

- **Widget name:** `Marino site forms`
- **Hostnames:** add the production site hostname `<domain>` **and** the preview hostnames you test forms on (e.g. `marino-site.pages.dev`, `*.marino-site.pages.dev`). Widgets are hostname-locked; a mismatch silently fails verification.
- **Widget mode:** Managed.
- Create → copy the **Site Key** (public → `VITE_TURNSTILE_SITE_KEY`, a build variable) and the **Secret Key** (→ `TURNSTILE_SECRET`, a Pages encrypted secret).

Local dev does not use Turnstile: set `TURNSTILE_BYPASS=1` in the site's `.dev.vars` only (never in Cloudflare).

**Return to the agent:** site key + secret key.

---

## 9. WAF rate limit on form intake **[Owner]**

**Dashboard:** the zone → **Security** → **WAF** → **Rate limiting rules** → **Create rule**:

- **Name:** `Form intake limit`
- **Expression:**
  ```
  starts_with(http.request.uri.path, "/api/forms/")
  ```
- **Rate:** `5` requests per `10` minutes, **counting by IP**.
- **Action:** **Block** (or **Managed Challenge** if you prefer a softer edge — the app's own per-source validation still runs behind it).
- Optional second rule later: same path, a higher limit, **Action: Block**, to catch distributed bursts.

This sits *in front of* the app. The app's own honeypot + Turnstile + per-source limits are separate and both apply.

---

## 10. Pages projects + DNS **[Owner]**

Two projects, both from the same repo (or the two repos, depending on the Phase 2 layout decision — see the inventory §9).

**Site project (`marino-site`):**
- Workers & Pages → **Create** → **Pages** → **Connect to Git** → pick the site repo.
- Production branch: `main`.
- Framework preset: **Vite**. Build command `npm run build`. Output directory `dist`.
- Root directory: leave as-is for a single-app repo; if the repo becomes the spec's monorepo, set it to the site's app folder.
- Add `SITE_ORIGIN`, `MEDIA_PUBLIC_BASE`, `VITE_TURNSTILE_SITE_KEY` as variables; `TURNSTILE_SECRET`, `IP_HASH_SALT`, `PREVIEW_SECRET` as encrypted secrets (§11).

**CMS project (`marino-cms`):**
- Workers & Pages → **Create** → **Pages** → **Connect to Git** → same repo.
- Root directory: leave blank (repo root).
- Build command: `npm run build`. Output: `admin/dist`. Functions are auto-detected from `functions/` at the repo root.
- Bindings: `DB` → `marino-cms`, `MEDIA` → `marino-media`, `CACHE` → the CACHE namespace. Preview deployments must use the preview D1/KV/bucket ids.
- Variables/secrets: §11.
- **Custom domain:** CMS project → **Custom domains** → **Set up a custom domain** → `cms.<domain>`. Cloudflare adds the CNAME.
- Attach the Access application from §7 to this hostname (Access usually does this automatically when the hostname matches the application).

**DNS (usually automatic):** `cms.<domain>` → CNAME → the CMS Pages project; `media.<domain>` → CNAME → the R2 custom domain from §4. Both zones' proxies are managed by Cloudflare; do not hand-create duplicates.

> **Order matters for Access.** Create the Pages project and its custom domain *before* finalising the Access application, so the exact hostname exists. Access will not protect a hostname that has never served.

---

## 11. Variables and secrets (spec §9.2)

Set these in **each project's Pages settings** (Settings → Variables and Secrets), and — once `wrangler.toml` exists as the source of truth for bindings (Phase 2 step 4) — keep names identical to the toml.

| Name | Project | Type | Purpose |
|---|---|---|---|
| `MEDIA_PUBLIC_BASE` | both | variable | `https://media.<domain>` |
| `SITE_ORIGIN` | both | variable | `https://<domain>` (Origin checks, preview links) |
| `CMS_ORIGIN` | cms | variable | `https://cms.<domain>` |
| `CF_ACCESS_TEAM_DOMAIN` | cms | variable | `<team>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | cms | **secret** | Access application AUD tag |
| `BOOTSTRAP_ADMIN_EMAIL` | cms | variable | first admin (seeds the `users` row) |
| `PREVIEW_SECRET` | both | **secret** | HMAC for preview tokens |
| `TURNSTILE_SECRET` | site | **secret** | server verification |
| `VITE_TURNSTILE_SITE_KEY` | site | build variable | widget key (public — safe to expose) |
| `IP_HASH_SALT` | site | **secret** | salt for `sha256(salt + ip)` |
| `RESEND_API_KEY`, `NOTIFY_FROM` | site | **secret** / variable | optional notification email |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | cms | **secret** | only if presigned uploads are built |

`DEV_USER_EMAIL` and `TURNSTILE_BYPASS` go in local `.dev.vars` **only** — never in Cloudflare.

Set a secret from the CLI (it prompts, so the value never appears in shell history or a log):
```bash
npx wrangler pages secret put CF_ACCESS_AUD --project-name marino-cms
npx wrangler pages secret put TURNSTILE_SECRET --project-name marino-site
```
List what exists (names only — values are never readable):
```bash
npx wrangler pages secret list --project-name marino-cms
```

**Limit:** 25 customer variables per project across preview + production (same name in both counts twice). Inspect before adding; reuse names when rotating.

---

## 12. Optional — Image Transformations **[Owner]**

**Dashboard:** the zone → **Images** → **Transformations** → enable. This allows `/cdn-cgi/image/width=…,format=auto/<url>` on `media.<domain>`, which the site uses to build `srcset` (Phase 10 step 6). Without it, the site falls back to the raw URL — parity does not depend on it.

---

## 13. Verification checklist (Phase 1 "Done when")

- [ ] `npx wrangler r2 bucket list` shows the bucket.
- [ ] `npx wrangler d1 list` shows `marino-cms` and `marino-cms-preview`.
- [ ] `npx wrangler kv namespace list` shows both CACHE namespaces.
- [ ] Uploading a test object and fetching it over `https://media.<domain>/…` returns **200** (test object deleted afterwards).
- [ ] `cms.<domain>` answers (even if only Access's login screen) and is **covered by an Access application**; an unauthenticated visit never reaches the CMS app.
- [ ] A Turnstile token verifies server-side against the widget's hostname (tested in Phase 6; a hostname mismatch fails here).
- [ ] WAF rate-limit rule is live on `/api/forms/*`.
- [ ] Both Pages projects exist; the CMS project has the D1/R2/KV bindings and the custom domain.

## 14. What to send back to the agent

The agent is blocked on Phase 2 until these arrive:

1. **Layout decision** (inventory §9, decision A) — where the CMS repo/code lives relative to the site.
2. `<domain>`; the R2 **bucket name**.
3. Both **D1 database ids** (prod + preview).
4. Both **KV namespace ids** (prod + preview).
5. Access **team domain** and **AUD tag**.
6. **Turnstile** site key + secret key.
7. Confirmation that `media.<domain>` serves an object (the §4 check).
8. Access **editor emails + roles** (who is `admin` / `editor` / `viewer`), and the identity provider.
9. Whether presigned uploads (videos > 50 MB) are wanted (§5).
