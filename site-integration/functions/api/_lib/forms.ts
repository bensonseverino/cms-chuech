import { error } from './types'
import type { Env } from './types'

/*
 * Form intake helpers.
 *
 * Two contracts live here for one release:
 *  - the LEGACY projects-spec contract (`POST /api/forms/:source`, flat body)
 *  - the forms-reviews contract (§4): `POST /api/public/forms/:slug/submissions`
 *    with `{ values, website, elapsedMs, turnstileToken, context }`.
 *
 * The frontend is migrated to the new contract in the same release; the legacy
 * endpoint stays so nothing that works today breaks. The security primitives
 * (origin, Turnstile, IP hashing, ULID ids) are shared by both.
 */

// --- Shared security primitives ----------------------------------------------

/**
 * CSRF guard: the browser's Origin must equal the deployment origin, the
 * configured SITE_ORIGIN, or an explicit ALLOWED_ORIGINS entry (spec §4 step 2;
 * §13: no wildcard origins in production).
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

  const extra = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean)

  const candidates = [
    selfOrigin.toLowerCase(),
    (env.SITE_ORIGIN ?? '').replace(/\/+$/, '').toLowerCase(),
    ...extra,
  ].filter(Boolean)

  return candidates.includes(origin.trim().replace(/\/+$/, '').toLowerCase())
}

/**
 * Server-side Turnstile verification (spec §4 step 7).
 *
 * Turnstile is only enforced when the deployment is actually configured for it:
 * the browser renders the widget only when VITE_TURNSTILE_SITE_KEY was baked
 * into the build, so a missing TURNSTILE_SECRET here must not reject every
 * submission. In that case the check is a no-op and spam control stays with the
 * honeypot, rate limit and elapsed-time trap. Once both are configured the
 * verification below applies to every request again.
 */
export async function verifyTurnstile(
  token: string | undefined,
  request: Request,
  env: Env,
): Promise<boolean> {
  if (env.TURNSTILE_BYPASS) return true
  if (!env.TURNSTILE_SECRET) return true
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

/**
 * Cloudflare gives us the real client IP via `CF-Connecting-IP`. Stored only as
 * a salted SHA-256 hex digest (spec §13): useful for dedupe, useless to an
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

// --- Form definitions (forms-reviews spec §3) ----------------------------------

export type FormFieldDef = {
  id: string
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'checkboxes' | 'url'
  label: string
  placeholder?: string
  required?: boolean
  options?: string[]
  validation?: { min?: number; max?: number; pattern?: string; message?: string }
}

export type FormRecord = {
  source: string
  label: string
  enabled: number
  notify_emails: string
  success_message: string
  fields: string
  autoresponder: string | null
}

export async function getForm(env: Env, source: string): Promise<FormRecord | null> {
  return env.DB.prepare(
    `SELECT source, label, enabled, notify_emails, success_message, fields, autoresponder
       FROM forms WHERE source = ?`,
  )
    .bind(source)
    .first<FormRecord>()
}

/**
 * Field-validation caps used when a field defines none (spec §3): text/tel/email
 * 200 chars, textarea 5000. Select/radio values must match `options`.
 */
const DEFAULT_CAPS: Record<string, number> = {
  text: 200,
  email: 200,
  tel: 200,
  url: 200,
  textarea: 5000,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s()+-]+$/

/** Control characters (except tab/newline in textareas) never belong in values. */
function stripControl(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

export type CleanValues = { values: Record<string, string | string[] | boolean> }

/**
 * Validate visitor values against the form's field definitions (spec §4 step 6):
 * trim strings, strip control characters, enforce required/format/length caps,
 * strip unknown keys. Returns per-field messages in the §4 response shape.
 */
export function validateFieldValues(
  defs: FormFieldDef[],
  raw: unknown,
): { values: Record<string, string | string[] | boolean>; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {}
  const values: Record<string, string | string[] | boolean> = {}
  const input =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}

  for (const def of defs) {
    const value = input[def.id]

    // Checkbox: boolean on/off.
    if (def.type === 'checkbox') {
      values[def.id] = value === true || value === 'true' || value === 'on'
      continue
    }

    // Multi-select / checkbox group: array of options.
    if (def.type === 'checkboxes') {
      const list = Array.isArray(value) ? value : []
      const cleaned = list
        .filter((item): item is string => typeof item === 'string')
        .map((item) => stripControl(item.trim()))
        .filter((item) => def.options?.includes(item))
      if (def.required && cleaned.length === 0) {
        fieldErrors[def.id] = 'Choose at least one option.'
      }
      values[def.id] = cleaned
      continue
    }

    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (def.required) {
        // The label usually carries the wording already (e.g. "Your project").
        fieldErrors[def.id] = `Enter ${def.label.replace(/\*$/, '').toLowerCase()}.`
      }
      continue
    }

    if (typeof value !== 'string') {
      fieldErrors[def.id] = 'Enter a valid value.'
      continue
    }

    const text = stripControl(value.trim())

    if (def.type === 'select' || def.type === 'radio') {
      if (def.options && !def.options.includes(text)) {
        fieldErrors[def.id] = 'Choose one of the listed options.'
        continue
      }
      values[def.id] = text
      continue
    }

    if (def.type === 'email' && !EMAIL_RE.test(text)) {
      fieldErrors[def.id] = 'Enter a valid email address.'
      continue
    }
    if (def.type === 'tel' && !PHONE_RE.test(text)) {
      fieldErrors[def.id] = 'Enter a valid phone number.'
      continue
    }
    if (def.type === 'url' && !/^https:\/\//.test(text)) {
      fieldErrors[def.id] = 'Enter a valid URL.'
      continue
    }

    const cap = def.validation?.max ?? DEFAULT_CAPS[def.type] ?? 200
    if (text.length > cap) {
      fieldErrors[def.id] = `Keep this under ${cap} characters.`
      continue
    }
    const min = def.validation?.min
    if (min !== undefined && text.length < min) {
      fieldErrors[def.id] = def.validation?.message ?? `Enter at least ${min} characters.`
      continue
    }

    values[def.id] = text
  }

  return { values, fieldErrors }
}

/** The form's field definitions, parsed safely. */
export function parseFieldDefs(raw: string | null | undefined): FormFieldDef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is FormFieldDef =>
        typeof item === 'object' && item !== null &&
        typeof (item as FormFieldDef).id === 'string' &&
        typeof (item as FormFieldDef).label === 'string',
    )
  } catch {
    return []
  }
}

/** Sender identity helpers pulled out of the validated values, when present. */
export function senderFields(values: Record<string, string | string[] | boolean>) {
  const pick = (key: string) => {
    const value = values[key]
    return typeof value === 'string' ? value : undefined
  }
  const email = pick('email')
  return {
    name: pick('name') ?? pick('first_name'),
    email: email && EMAIL_RE.test(email) ? email : undefined,
    phone: pick('phone'),
    message: pick('message'),
  }
}

/** Lowercased concat of every value — powers the inbox search (spec §3). */
export function buildSearchText(values: Record<string, string | string[] | boolean>): string {
  return Object.values(values)
    .map((value) =>
      Array.isArray(value)
        ? value.join(' ').toLowerCase()
        : typeof value === 'string'
          ? value.toLowerCase()
          : '',
    )
    .filter(Boolean)
    .join(' \u0001 ')
    .slice(0, 5000)
}

// --- Context (forms-reviews spec §4 step 9) --------------------------------------

export type SubmitContext = { page?: string; projectSlug?: string; projectTitle?: string }

/** Validated context, or undefined: strings ≤ 200 chars, `page` starts with `/`. */
export function cleanContext(raw: unknown): SubmitContext | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const input = raw as Record<string, unknown>
  const out: SubmitContext = {}

  const page = typeof input.page === 'string' ? stripControl(input.page.trim()).slice(0, 200) : ''
  if (page.startsWith('/')) out.page = page

  const slug = typeof input.projectSlug === 'string' ? stripControl(input.projectSlug.trim()).slice(0, 200) : ''
  if (slug) out.projectSlug = slug

  const title = typeof input.projectTitle === 'string' ? stripControl(input.projectTitle.trim()).slice(0, 200) : ''
  if (title) out.projectTitle = title

  return out.page || out.projectSlug || out.projectTitle ? out : undefined
}

// --- D1 rate limiter (forms-reviews spec §4 step 5) -------------------------------

export type RateResult = { allowed: boolean; retryAfter: number }

/**
 * Fixed-window counter in D1. `key` encodes the window name; the row is reset
 * when the window expires. 5/minute and 30/hour per hashed IP per form.
 */
export async function hitRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  const now = Math.floor(Date.now() / 1000)
  try {
    const result = await env.DB.prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start > ? - ? THEN rate_limits.count + 1 ELSE 1 END,
         window_start = CASE WHEN rate_limits.window_start > ? - ? THEN rate_limits.window_start ELSE ? END
       RETURNING count, window_start`,
    )
      .bind(key, now, now, windowSeconds, now, windowSeconds, now)
      .first<{ count: number; window_start: number }>()

    if (!result) return { allowed: true, retryAfter: 0 }
    const count = Number(result.count)
    const allowed = count <= limit
    const retryAfter = allowed ? 0 : Math.max(1, windowSeconds - (now - Number(result.window_start)))
    return { allowed, retryAfter }
  } catch (cause) {
    // A broken limiter must not block submissions; the WAF rule is the outer net.
    console.error('[forms] rate limit check failed', cause)
    return { allowed: true, retryAfter: 0 }
  }
}

/** 5/minute and 30/hour per hashed IP per form (spec §4 step 5). */
export async function checkFormRateLimits(
  env: Env,
  ipHash: string | null,
  slug: string,
): Promise<RateResult> {
  // An unhashable IP (no salt configured) still gets one shared bucket so the
  // limiter keeps meaning something locally.
  const key = ipHash ?? 'anonymous'
  const minute = await hitRateLimit(env, `form:${slug}:min:${key}`, 5, 60)
  if (!minute.allowed) return minute
  return hitRateLimit(env, `form:${slug}:hour:${key}`, 30, 3600)
}

// --- Duplicate guard (spec §4 step 8) ----------------------------------------------

/**
 * Same form + same IP + identical values within 10 minutes counts as a
 * double-click: respond 201 without storing again.
 */
export async function isRecentDuplicate(
  env: Env,
  slug: string,
  ipHash: string | null,
  searchText: string,
): Promise<boolean> {
  if (!ipHash) return false
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM submissions
        WHERE source = ? AND ip_hash = ? AND search_text = ?
          AND created_at > datetime('now', '-10 minutes')
        LIMIT 1`,
    )
      .bind(slug, ipHash, searchText)
      .first<{ id: string }>()
    return row !== null
  } catch (cause) {
    console.error('[forms] duplicate check failed', cause)
    return false
  }
}

// --- Email (forms-reviews spec §5) -------------------------------------------------

export type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
}

/**
 * `sendEmail` — Resend over fetch (spec §5; MailChannels is discontinued).
 * Returns the provider error message on failure; the caller decides whether
 * that matters (a failed notification never fails the submission).
 */
export async function sendEmail(env: Env, message: EmailMessage): Promise<{ ok: boolean; error?: string }> {
  const key = env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not configured' }
  const from = env.NOTIFY_FROM
  if (!from) return { ok: false, error: 'NOTIFY_FROM is not configured' }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const body = (await response.text()).slice(0, 300)
      return { ok: false, error: `Resend responded ${response.status}: ${body}` }
    }
    return { ok: true }
  } catch (cause) {
    console.error('[forms] email send failed', cause)
    return { ok: false, error: cause instanceof Error ? cause.message : 'send failed' }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A clean branded `label: value` table (spec §5). Every value is escaped. */
export function notificationHtml(
  formLabel: string,
  values: Record<string, string | string[] | boolean>,
  defs: FormFieldDef[],
  context: SubmitContext | undefined,
  submissionId: string,
  adminUrl: string,
  receivedAt: string,
): { html: string; text: string } {
  const rows = defs
    .map((def) => {
      const value = values[def.id]
      if (value === undefined || value === '' || value === false) return ''
      const shown = Array.isArray(value)
        ? escapeHtml(value.join(', '))
        : typeof value === 'boolean'
          ? 'Yes'
          : escapeHtml(value)
      return `<tr>
        <td style="padding:6px 12px;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(def.label.replace(/\*$/, ''))}</td>
        <td style="padding:6px 12px;color:#231f20"><strong>${shown}</strong></td>
      </tr>`
    })
    .join('')

  const contextRows = context
    ? `<tr>
        <td style="padding:6px 12px;color:#666;vertical-align:top;white-space:nowrap">Page</td>
        <td style="padding:6px 12px;color:#231f20">${escapeHtml(context.page ?? '')}${context.projectTitle ? ` — ${escapeHtml(context.projectTitle)}` : ''}</td>
      </tr>`
    : ''

  const link = `${adminUrl.replace(/\/+$/, '')}/inbox/${submissionId}`
  const html = `<div style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;max-width:560px">
    <h2 style="color:#231f20;font-size:18px;margin:0 0 4px">New &ldquo;${escapeHtml(formLabel)}&rdquo; submission</h2>
    <p style="color:#666;font-size:13px;margin:0 0 16px">Received ${escapeHtml(receivedAt)} (UTC)</p>
    <table style="border-collapse:collapse;font-size:14px;width:100%">${rows}${contextRows}</table>
    <p style="margin:20px 0 4px">
      <a href="${escapeHtml(link)}" style="background:#82ffcd;color:#231f20;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700;font-size:13px">Open in the CMS</a>
    </p>
  </div>`

  const textLines = defs
    .map((def) => {
      const value = values[def.id]
      if (value === undefined || value === '' || value === false) return ''
      const shown = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? 'Yes' : value
      return `${def.label.replace(/\*$/, '')}: ${shown}`
    })
    .filter(Boolean)
  if (context?.page) textLines.push(`Page: ${context.page}${context.projectTitle ? ` — ${context.projectTitle}` : ''}`)
  const text = `New "${formLabel}" submission (${receivedAt} UTC)\n\n${textLines.join('\n')}\n\n${link}`

  return { html, text }
}

/** Recipients: the form's list, else the global `site_settings.notifications`. */
export async function notificationRecipients(env: Env, notifyEmails: string): Promise<string[]> {
  const fromForm = JSON.parse(notifyEmails || '[]') as unknown
  if (Array.isArray(fromForm) && fromForm.length > 0) {
    return fromForm.filter((item): item is string => typeof item === 'string' && item.includes('@'))
  }

  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'notifications'")
      .first<{ value: string }>()
    if (row?.value) {
      const parsed = JSON.parse(row.value) as { emails?: unknown }
      if (Array.isArray(parsed.emails)) {
        return parsed.emails.filter((item): item is string => typeof item === 'string' && item.includes('@'))
      }
    }
  } catch {
    // site_settings may not exist yet in fresh databases — fall through.
  }
  return env.NOTIFY_DEFAULT_TO ? [env.NOTIFY_DEFAULT_TO] : []
}

/**
 * The owner notification (spec §4 step 10, §5). The subject is built only from
 * the form name — never visitor input. A failure updates `notify_status` and
 * never fails the submission.
 */
export async function notifyOwner(
  env: Env,
  id: string,
  form: FormRecord,
  values: Record<string, string | string[] | boolean>,
  context: SubmitContext | undefined,
  defs: FormFieldDef[],
): Promise<void> {
  const mark = (status: 'sent' | 'failed' | 'skipped', notifyError?: string) =>
    env.DB
      .prepare('UPDATE submissions SET notify_status = ?, notify_error = ? WHERE id = ?')
      .bind(
        status,
        notifyError ? notifyError.slice(0, 300) : null,
        id,
      )
      .run()
      .catch((cause) => console.error('[forms] notify status update failed', cause))

  try {
    // Missing provider config is 'skipped' (§5), not 'failed': nothing was
    // attempted. The CMS shows a configuration warning either way.
    if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) {
      await mark('skipped', 'Email provider not configured')
      return
    }

    const recipients = await notificationRecipients(env, form.notify_emails)
    if (recipients.length === 0) {
      await mark('skipped', 'No recipients configured')
      return
    }

    const receivedAt = new Date().toISOString().replace('T', ' ').slice(0, 16)
    const { html, text } = notificationHtml(
      form.label,
      values,
      defs,
      context,
      id,
      env.ADMIN_URL ?? '',
      receivedAt,
    )

    const senderEmail = values.email
    const to = recipients[0]
    if (!to) {
      await mark('skipped', 'No recipients configured')
      return
    }
    const result = await sendEmail(env, {
      to,
      subject: `New "${form.label}" submission`,
      html,
      text,
      ...(typeof senderEmail === 'string' && EMAIL_RE.test(senderEmail)
        ? { replyTo: senderEmail }
        : {}),
    })

    if (result.ok) {
      await mark('sent')
    } else {
      await mark('failed', result.error)
    }
  } catch (cause) {
    await mark('failed', cause instanceof Error ? cause.message : 'notification failed')
  }
}

/** Optional autoresponder (spec §5, off by default). `{{name}}` substitution, escaped. */
export async function sendAutoresponder(
  env: Env,
  form: FormRecord,
  values: Record<string, string | string[] | boolean>,
): Promise<void> {
  if (!form.autoresponder) return
  try {
    const config = JSON.parse(form.autoresponder) as { enabled?: boolean; subject?: string; body?: string }
    if (!config.enabled || !config.subject || !config.body) return
    const email = values.email
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) return

    const name = typeof values.name === 'string' ? values.name : ''
    const body = escapeHtml(config.body).replace(/\{\{name\}\}/g, escapeHtml(name) || 'there')
    await sendEmail(env, {
      to: email,
      subject: config.subject,
      html: `<div style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;white-space:pre-wrap">${body}</div>`,
      text: config.body.replace(/\{\{name\}\}/g, name || 'there'),
    })
  } catch (cause) {
    console.error('[forms] autoresponder failed', cause)
  }
}

// --- Legacy-contract exports (POST /api/forms/:source; kept for one release) ------

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

/** First-pass validation for the legacy flat-body contract. */
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

export type FieldError = { path: string; message: string }

/** The validated legacy `_context`, or undefined. */
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

/** 5 submissions per IP per minute against one source (legacy contract). */
export async function underFormRateLimit(env: Env, ip: string | null, source: string): Promise<boolean> {
  if (!ip) return true
  const ipHash = await hashIp(ip, env)
  if (!ipHash) return true
  const result = await hitRateLimit(env, `form:${source}:min:${ipHash.slice(0, 16)}`, 5, 60)
  return result.allowed
}

export type LegacyFormRow = {
  source: string
  label: string
  enabled: number
  notify_emails: string
  success_message: string
}

export async function getLegacyForm(env: Env, source: string): Promise<LegacyFormRow | null> {
  return env.DB.prepare(
    'SELECT source, label, enabled, notify_emails, success_message FROM forms WHERE source = ?',
  )
    .bind(source)
    .first<LegacyFormRow>()
}

export type InsertResult = { ok: true; id: string } | { ok: false; response: Response }

/** Legacy INSERT. `fields` carries the extra inputs; `_context` merges in. */
export async function insertSubmission(
  env: Env,
  source: string,
  payload: FormSubmissionPayload,
  meta: { turnstileOk: boolean; ipHash: string | null; userAgent: string | null },
): Promise<InsertResult> {
  const id = submissionId()

  const context = contextForFields(payload)
  const fields = { ...(payload.fields ?? {}), ...(context ? { _context: context } : {}) }

  try {
    await env.DB.prepare(
      `INSERT INTO submissions
         (id, source, status, name, email, phone, message, fields, page_path, referrer, utm, user_agent, ip_hash, turnstile_ok, notify_status)
       VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped')`,
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
        meta.userAgent ? meta.userAgent.slice(0, 200) : null,
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

// --- New-contract INSERT ------------------------------------------------------------

/**
 * Insert a §4-contract submission: `status = 'new'`, salted ip hash, UA
 * truncated to 200, `source_url` from Origin/Referer, validated `context`
 * column, `search_text` for the inbox search.
 */
export async function insertSubmissionV2(
  env: Env,
  slug: string,
  values: Record<string, string | string[] | boolean>,
  meta: {
    context: SubmitContext | undefined
    ipHash: string | null
    userAgent: string | null
    sourceUrl: string | null
    turnstileOk: boolean
  },
): Promise<{ ok: true; id: string; searchText: string } | { ok: false; response: Response }> {
  const id = submissionId()
  const sender = senderFields(values)
  const searchText = buildSearchText(values)

  try {
    await env.DB.prepare(
      `INSERT INTO submissions
         (id, source, status, name, email, phone, message, fields, page_path, referrer, utm, user_agent, ip_hash, turnstile_ok, context, search_text, notify_status)
       VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, 'pending')`,
    )
      .bind(
        id,
        slug,
        sender.name ?? null,
        sender.email ?? null,
        sender.phone ?? null,
        sender.message ?? null,
        JSON.stringify(values),
        meta.context?.page ?? null,
        meta.sourceUrl,
        meta.userAgent ? meta.userAgent.slice(0, 200) : null,
        meta.ipHash,
        meta.turnstileOk ? 1 : 0,
        JSON.stringify(meta.context ?? {}),
        searchText,
      )
      .run()
    return { ok: true, id, searchText }
  } catch (cause) {
    console.error('[forms] insert failed', cause)
    return { ok: false, response: error('server_error', 'Could not save your submission') }
  }
}
