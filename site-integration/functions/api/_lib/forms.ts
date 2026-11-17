import { error, underRateLimit } from './types'
import type { Env } from './types'

/*
 * Form intake helpers (spec §6): the security gate and the INSERT, shared by
 * every `functions/api/forms/:source.ts` function so no form can drift.
 */

// --- Honeypot ----------------------------------------------------------------

/**
 * The honeypot field. Rendered by the site (hidden input named exactly this);
 * bot-filled submissions fail here. Never send the field name to analytics.
 */
export const HONEYPOT_FIELD = '_gotcha'

export type FormContext = {
  /** The case study the form was submitted from, e.g. 'eventotron'. */
  projectSlug?: string
  /** The case study title shown in the inbox, e.g. 'Eventotron'. */
  projectTitle?: string
}

export type FormSubmissionPayload = {
  name?: string
  email?: string
  phone?: string
  message?: string
  fields?: Record<string, unknown>
  /** Reserved key (cms-projects-spec.md §8): which project page sent this. */
  _context?: FormContext
  pagePath?: string
  referrer?: string
  utm?: { source?: string; medium?: string; campaign?: string; term?: string; content?: string }
  turnstileToken?: string
  [HONEYPOT_FIELD]?: unknown
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type FieldError = { path: string; message: string }

/** First-pass validation before any D1/Network traffic. */
export function validatePayload(payload: FormSubmissionPayload): FieldError[] {
  const errors: FieldError[] = []

  if (payload.email && !EMAIL_RE.test(payload.email)) {
    errors.push({ path: 'email', message: 'Enter a valid email address' })
  }

  const fields = payload.fields ?? {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value.length > 3000) {
      errors.push({ path: `fields.${key}`, message: 'Too long' })
    }
  }

  if (!payload.email && !payload.phone) {
    errors.push({ path: 'phone', message: 'Add an email or a phone number so we can reply' })
  }

  // Reserved `_context` (cms-projects-spec.md §8): both keys are optional but,
  // when present, strings of at most 200 chars — never an arbitrary object.
  const context = payload._context
  if (context !== undefined) {
    if (typeof context !== 'object' || context === null || Array.isArray(context)) {
      errors.push({ path: '_context', message: 'Invalid context' })
    } else {
      for (const key of ['projectSlug', 'projectTitle'] as const) {
        const value = (context as FormContext)[key]
        if (value !== undefined && (typeof value !== 'string' || value.length > 200)) {
          errors.push({ path: `_context.${key}`, message: 'Too long' })
        }
      }
    }
  }

  return errors
}

/**
 * The validated `_context`, or undefined. Stored inside the submission's
 * `fields` JSON under the same key so the inbox can show (and filter by) the
 * project a call-back came from without a schema change.
 */
export function contextForFields(payload: FormSubmissionPayload): FormContext | undefined {
  const context = payload._context
  if (typeof context !== 'object' || context === null || Array.isArray(context)) return undefined

  const out: FormContext = {}
  const slug = typeof context.projectSlug === 'string' ? context.projectSlug.slice(0, 200) : undefined
  const title =
    typeof context.projectTitle === 'string' ? context.projectTitle.slice(0, 200) : undefined
  if (slug) out.projectSlug = slug
  if (title) out.projectTitle = title
  return out.projectSlug || out.projectTitle ? out : undefined
}

// --- Origin ------------------------------------------------------------------

/**
 * CSRF guard (spec §7): the browser's Origin must equal the deployment origin.
 * Also accepts the configured SITE_ORIGIN so 218-hotfix deploys and custom
 * domains compare sanely — when they differ the deploy origin wins.
 */
export function isSameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return false

  let selfOrigin: string
  try {
    selfOrigin = new URL(request.url).origin
  } catch {
    return false
  }

  const expected = env.SITE_ORIGIN.replace(/\/+$/, '')
  const candidates = [selfOrigin.toLowerCase(), expected.toLowerCase()].filter(Boolean)
  return candidates.includes(origin.trim().replace(/\/+$/, '').toLowerCase())
}

// --- Turnstile ---------------------------------------------------------------

/**
 * Server-side Turnstile verification (spec §7). Skipped only when
 * `TURNSTILE_SECRET` is absent (misconfigured deploy: fail the request, do not
 * silently accept) or `TURNSTILE_BYPASS` is set for local dev.
 */
export async function verifyTurnstile(
  token: string | undefined,
  request: Request,
  env: Env,
): Promise<boolean> {
  if (env.TURNSTILE_BYPASS) return true
  if (!env.TURNSTILE_SECRET) return false
  if (!token) return false

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        // Optional but recommended: binds the token to this request's IP.
        remoteip: clientIp(request) ?? '',
      }),
      signal: AbortSignal.timeout(5000),
    })

    const result = (await response.json()) as { success: boolean }
    return result.success === true
  } catch (cause) {
    console.error('[forms] turnstile verification failed', cause)
    return false
  }
}

// --- Client IP (salted hash) ---------------------------------------------------

/**
 * Cloudflare gives us the real client IP via `CF-Connecting-IP`. Stored only as
 * a salted SHA-256 hex digest (spec §6, §7): useful for dedupe, useless to an
 * attacker who reads the DB copy.
 */
export function clientIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? null
}

export async function hashIp(ip: string | null, env: Env): Promise<string | null> {
  if (!ip) return null
  const salt = env.IP_HASH_SALT
  if (!salt) return null

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// --- Rate limiting wrapper -----------------------------------------------------

export async function underFormRateLimit(env: Env, ip: string | null, source: string): Promise<boolean> {
  if (!ip) return true
  // 5 submissions per IP per minute against one source (spec §7.2). WAF rule
  // enforces the same thing at the edge; this is the cheap second net.
  return underRateLimit(env, `form:${source}:${await hashIpShort(ip, env)}`, 5, 60)

  async function hashIpShort(ip: string, env: Env): Promise<string> {
    const digestIp = await hashIp(ip, env)
    return digestIp ? digestIp.slice(0, 16) : 'unknown'
  }
}

// --- Forms registry ------------------------------------------------------------

export type FormRow = {
  source: string
  label: string
  enabled: number
  notify_emails: string
  success_message: string
}

export async function getForm(env: Env, source: string): Promise<FormRow | null> {
  return env.DB.prepare(
    'SELECT source, label, enabled, notify_emails, success_message FROM forms WHERE source = ?',
  )
    .bind(source)
    .first<FormRow>()
}

// --- Persist -------------------------------------------------------------------

/** A submission id: ULID-style, lexically sortable. */
export function submissionId(): string {
  let time = ''
  let remaining = Date.now()
  for (let i = 9; i >= 0; i -= 1) {
    time = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[remaining % 32] + time
    remaining = Math.floor(remaining / 32)
  }
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[byte % 32]
  return `sub_${time}${out}`
}

export type InsertResult = { ok: true; id: string } | { ok: false; response: Response }

/**
 * Insert the submission. `fields` carries every input the form's own schema did
 * not map above (checkbox arrays, budget, whatever the form defines). Draft
 * fields over 3000 chars were rejected at validation.
 */
export async function insertSubmission(
  env: Env,
  source: string,
  payload: FormSubmissionPayload,
  meta: { turnstileOk: boolean; ipHash: string | null; userAgent: string | null },
): Promise<InsertResult> {
  const id = submissionId()

  // `_context` is not an owner-typed input: it merges into the extra-fields
  // JSON so the inbox can show and filter by the project (cms-projects-spec.md §8).
  const context = contextForFields(payload)
  const fields = { ...(payload.fields ?? {}), ...(context ? { _context: context } : {}) }

  try {
    await env.DB.prepare(
      `INSERT INTO submissions
         (id, source, status, name, email, phone, message, fields, page_path, referrer, utm, user_agent, ip_hash, turnstile_ok)
       VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        source,
        payload.name ?? null,
        payload.email ?? null,
        payload.phone ?? null,
        payload.message ?? null,
        JSON.stringify(fields),
        payload.pagePath ?? null,
        payload.referrer ?? null,
        JSON.stringify(payload.utm ?? {}),
        meta.userAgent,
        meta.ipHash,
        meta.turnstileOk ? 1 : 0,
      )
      .run()
  } catch (cause) {
    console.error('[forms] insert failed', cause)
    return { ok: false, response: error('server_error', 'Could not save your submission') }
  }

  return { ok: true, id }
}


