/*
 * Vendored-lite server kit for the site's Pages Functions.
 *
 * Derivation note (see site-integration/README.md): the public-read and
 * cache/rate-limit logic here is a slim, self-contained copy of the shapes in
 * `@marino/api-kit` (packages/api-kit/src/http.ts, cache.ts, media.ts, types.ts).
 * The site repo cannot depend on the CMS workspace's packages, so these
 * helpers are vendored WITH the functions by the sync script. When you change
 * an idea here (error codes, cache headers, the media reference shape), change
 * the original too and re-sync — the two must not drift.
 *
 * The binding types are declared HERE, narrowly (the same decision api-kit
 * made): `@cloudflare/workers-types` reshuffles between majors and this slice
 * is small and stable.
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
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

// --- R2 ---------------------------------------------------------------------

export interface R2ObjectBody {
  body: ReadableStream
  httpEtag?: string
  httpMetadata?: { contentType?: string }
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
}

// --- KV ---------------------------------------------------------------------

export interface KVNamespace {
  get(key: string, options?: { cacheTtl?: number; type?: 'text' }): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

// --- Bindings + variables (site project; see site-integration/wrangler.toml) --

export interface Env {
  DB: D1Database
  /** The shared media bucket. Read by functions/media/[[path]].ts. */
  MEDIA: R2Bucket
  CACHE: KVNamespace

  MEDIA_PUBLIC_BASE: string
  SITE_ORIGIN: string

  // --- Optional / local-only ---------------------------------------------
  TURNSTILE_SECRET?: string
  IP_HASH_SALT?: string
  /** Local dev only — never set in Cloudflare. */
  TURNSTILE_BYPASS?: string
}

// --- Pages Functions context -------------------------------------------------

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/** The context a Pages Function receives. */
export interface PagesContext<E = Env> {
  request: Request
  env: E
  params: Record<string, string | string[] | undefined>
  data: Record<string, unknown>
  next(input?: Request | string, init?: RequestInit): Promise<Response>
  waitUntil(promise: Promise<unknown>): void
}

export type PagesFunction<E = Env> = (
  context: PagesContext<E>,
) => Response | Promise<Response>

/** Alias kept for readability at call sites that pass a context around. */
export type Ctx = ExecutionContext

// --- JSON responses ---------------------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unprocessable'
  | 'rate_limited'
  | 'server_error'

export type FieldError = { path: string; message: string }

export type ApiError = { error: { code: ErrorCode; message: string; fields?: FieldError[] } }

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  server_error: 500,
}

export function json<T>(data: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

/** The public API's envelope: `{ data, version }` (spec §6). */
export function dataResponse<T>(data: T, version: number, init: ResponseInit = {}): Response {
  return json({ data, version }, init)
}

export function error(
  code: ErrorCode,
  message: string,
  options: { fields?: FieldError[]; headers?: HeadersInit } = {},
): Response {
  const body: ApiError = { error: { code, message } }
  if (options.fields && options.fields.length > 0) body.error.fields = options.fields

  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status: STATUS_BY_CODE[code], headers })
}

export function methodNotAllowed(allowed: readonly string[]): Response {
  return error('method_not_allowed', `Use ${allowed.join(' or ')} on this route`, {
    headers: { Allow: allowed.join(', ') },
  })
}

// --- Content version and edge cache ------------------------------------------

const VERSION_KEY = 'content_version'

/**
 * The current content version, read from KV with a short TTL. Falls back to the
 * D1 `meta` row (and then to 1) — publishing must never depend on KV freshness
 * being perfect, only on the version number going UP.
 */
export async function contentVersion(env: Env): Promise<number> {
  try {
    const raw = await env.CACHE.get(VERSION_KEY, { cacheTtl: 30 })
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  } catch (cause) {
    console.error('[cache] contentVersion read failed', cause)
  }

  try {
    const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?')
      .bind(VERSION_KEY)
      .first<{ value: string }>()
    const parsed = Number(row?.value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  } catch (cause) {
    console.error('[cache] contentVersion db read failed', cause)
  }
  return 1
}

function edgeCache(): Cache | null {
  const candidate = (caches as unknown as { default?: Cache }).default
  return candidate ?? null
}

function cacheKey(request: Request, version: number): Request {
  const url = new URL(request.url)
  url.searchParams.set('__v', String(version))
  return new Request(url.toString(), { method: 'GET' })
}

/**
 * Serve a GET through the edge cache, keyed by URL + content version. The Cache
 * API is unavailable on some hostnames, so every call is guarded: a cache
 * failure must degrade to a plain produce(), never break the request.
 */
export async function withEdgeCache(
  request: Request,
  ctx: Pick<PagesContext, 'waitUntil'>,
  version: number,
  produce: () => Promise<Response>,
): Promise<Response> {
  const cache = edgeCache()
  const key = cacheKey(request, version)

  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) return hit
    } catch (cause) {
      console.error('[cache] match failed', cause)
    }
  }

  const response = await produce()
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60')
  headers.set('X-Content-Version', String(version))

  const out = new Response(response.body, { status: response.status, headers })

  if (cache && response.status === 200) {
    try {
      const snapshot = new Response(out.clone().body, out)
      ctx.waitUntil(cache.put(key, snapshot))
    } catch (cause) {
      console.error('[cache] put failed', cause)
    }
  }

  return out
}

// --- Rate limiting (form intake) ----------------------------------------------

/**
 * Count a request against a KV bucket. True when the caller is UNDER the limit.
 * Faults never block a real submission: the WAF rule is the real ceiling and
 * this is the cheap second net (spec §1, §6).
 */
export async function underRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`

  try {
    const raw = await env.CACHE.get(bucket)
    const count = Number(raw ?? '0')
    if (count >= limit) return false

    await env.CACHE.put(bucket, String(count + 1), {
      expirationTtl: Math.max(60, windowSeconds + 10),
    })
    return true
  } catch (cause) {
    console.error('[cache] rate limit failed', cause)
    return true
  }
}

// --- Origin ------------------------------------------------------------------

/**
 * A browser form POST always sends an `Origin` header on the same origin, and
 * it must equal the origin the request actually arrived at. Anything else is
 * rejected (spec §7).
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return false

  let selfOrigin: string
  try {
    selfOrigin = new URL(request.url).origin
  } catch {
    return false
  }

  return origin.trim().replace(/\/+$/, '').toLowerCase() === selfOrigin.toLowerCase()
}
