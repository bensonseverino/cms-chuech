/*
 * Bindings, environment and the Pages Functions context.
 *
 * The platform types (`D1Database`, `R2Bucket`, `KVNamespace`, `PagesFunction`)
 * are declared HERE, narrowly, rather than pulled from
 * `@cloudflare/workers-types`. Two reasons:
 *
 *   1. That package's shape moves between majors (v4 → v5 reshuffled the
 *      generated types), and a shifted type name would break the whole
 *      workspace's typecheck for a reason unrelated to this code.
 *   2. We use a small, stable slice of each binding; declaring exactly that
 *      slice documents the contract and makes `api-kit` typecheck on its own.
 *
 * `lib: DOM` supplies `Request`/`Response`/`Headers`/`crypto`/`URL`, which the
 * Workers runtime and the DOM describe compatibly for the parts we touch.
 *
 * Bindings are provided by wrangler from `wrangler.toml` at runtime; only
 * `globalThis.caches` and the `Cf-*` headers come from the platform directly.
 */

// --- D1 ---------------------------------------------------------------------

export interface D1Result<T> {
  results: T[]
  success: boolean
  meta: unknown
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(column?: string): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run(): Promise<{ success: boolean; meta?: unknown }>
  raw<T = unknown>(): Promise<T[]>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<{ count: number; duration: number }>
}

// --- R2 ---------------------------------------------------------------------

export interface R2Object {
  key: string
  size: number
  etag?: string
  httpMetadata?: { contentType?: string }
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream
}

export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<R2Object>
  get(key: string): Promise<R2ObjectBody | null>
  head(key: string): Promise<R2Object | null>
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: R2Object[]
    truncated: boolean
    cursor?: string
  }>
  delete(key: string | string[]): Promise<void>
}

// --- KV ---------------------------------------------------------------------

export interface KVNamespace {
  get(key: string, options?: { cacheTtl?: number; type?: 'text' }): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }>
}

// --- Pages Functions --------------------------------------------------------

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/** The context a Pages Function receives. */
export interface PagesContext<E = Env> {
  request: Request
  env: E
  params: Record<string, string>
  data: Record<string, unknown>
  next(input?: Request | string, init?: RequestInit): Promise<Response>
  waitUntil(promise: Promise<unknown>): void
}

export type PagesFunction<E = Env> = (
  context: PagesContext<E>,
) => Response | Promise<Response>

/*
 * The bindings and variables both Pages projects can rely on (spec §9.1/§9.2).
 *
 * Everything optional here is genuinely optional in some deployment: the site
 * project has no Access settings, the CMS project has no Turnstile secret. Code
 * that needs one must treat its absence as a configuration error at the point
 * of use (fail closed), never as "skip the check".
 */
export interface Env {
  // --- Bindings (fixed names; see wrangler.toml) ---------------------------
  /** D1: content, media index, forms, submissions, audit. */
  DB: D1Database
  /** R2: the shared media bucket (`uploads/…`). */
  MEDIA: R2Bucket
  /** KV: `content_version` plus form rate-limit counters. */
  CACHE: KVNamespace

  // --- Variables -----------------------------------------------------------
  /** Public base for media URLs, e.g. `https://media.example.com`. */
  MEDIA_PUBLIC_BASE: string
  /** The public site's origin, used for Origin checks and preview links. */
  SITE_ORIGIN: string
  /** The admin origin. Required for CSRF checks in the CMS project. */
  CMS_ORIGIN?: string

  // --- CMS-only variables --------------------------------------------------
  /** Owner-only bootstrap email, also used by /api/auth/dev-auto-login. */
  BOOTSTRAP_ADMIN_EMAIL?: string
  /** Cloudflare Access, optional now that the CMS also supports password sessions. */
  CF_ACCESS_TEAM_DOMAIN?: string
  /** Access application AUD tag (a secret, but read as a string here). */
  CF_ACCESS_AUD?: string

  /** Credentials used by `npm run db:seed-admin`; production values are secrets. */
  ADMIN_EMAIL?: string
  /** Owner password, read only in the auth endpoints/seed script. */
  ADMIN_PASSWORD?: string
  /** `development`/`production`, used only to gate dev-only code. */
  ENV?: string
  /** Local-only auto-login toggled by one endpoint; must never be set here. */
  AUTO_LOGIN?: string

  // --- Optional / local-only ----------------------------------------------
  /** HMAC key for preview tokens (secret). */
  PREVIEW_SECRET?: string
  /** Turnstile secret (site project only). */
  TURNSTILE_SECRET?: string
  /** Salt for IP hashing (secret). */
  IP_HASH_SALT?: string
  /** Local dev only — never set in Cloudflare. */
  DEV_USER_EMAIL?: string
  /** Local dev only — bypasses Turnstile verification. */
  TURNSTILE_BYPASS?: string
}

/** Alias kept for readability at call sites that pass a context around. */
export type Ctx = ExecutionContext
