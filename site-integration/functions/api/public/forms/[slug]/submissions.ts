import { error, json } from '../../../_lib/types'
import {
  buildSearchText,
  checkFormRateLimits,
  cleanContext,
  clientIp,
  getForm,
  hashIp,
  insertSubmissionV2,
  isRecentDuplicate,
  isSameOrigin,
  notifyOwner,
  parseFieldDefs,
  sendAutoresponder,
  validateFieldValues,
  verifyTurnstile,
} from '../../../_lib/forms'
import type { Env, PagesContext } from '../../../_lib/types'

/*
 * POST /api/public/forms/:slug/submissions — the forms-reviews-spec.md §4
 * pipeline, in its fixed order (cheapest and most abusive first):
 *
 *   1. OPTIONS short-circuit
 *   2. 32 KB body cap, JSON parse
 *   3. Origin check (CSRF — no wildcard origins; §13)
 *   4. form must exist and be enabled
 *   5. silent drops: honeypot `website` filled, or elapsedMs < 2000 → 201,
 *      NOTHING stored (bots learn nothing; a human double-click cannot be fast)
 *   6. D1 rate limit: 5/minute + 30/hour per hashed IP per form → 429 + retryAfter
 *   7. validate `values` against the form's field definitions
 *   8. Turnstile server-side verification
 *   9. duplicate guard: same form + values hash within 10 minutes → 201, no store
 *  10. INSERT (status 'new'), then notifications via waitUntil — a failed email
 *      never fails the submission (§5)
 *
 * Success returns 201 `{ ok, message }`. No submission id is ever in the
 * response body (§4).
 */

const MAX_BODY_BYTES = 32 * 1024
/** Anything faster than this is a bot (§4 step 4). */
const MIN_HUMAN_ELAPSED_MS = 2000

export const onRequest = async (context: PagesContext<Env>): Promise<Response> => {
  const { request, params } = context

  if (request.method === 'OPTIONS') return preflight()
  if (request.method === 'POST') return handlePost(context, asString(params.slug))

  return error('method_not_allowed', 'Use POST or OPTIONS on this route', {
    headers: { Allow: 'POST, OPTIONS' },
  })
}

async function handlePost(context: PagesContext<Env>, slug: string): Promise<Response> {
  const { request, env } = context

  // --- 2. body ------------------------------------------------------------
  const parsed = await readJson(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  // --- 3. origin (CSRF) ---------------------------------------------------
  if (!isSameOrigin(request, env)) {
    return error('forbidden', 'Request must come from the site')
  }

  // --- 4. form exists and is enabled ---------------------------------------
  if (!slug) return error('not_found', 'This form is not configured')
  const form = await getForm(env, slug)
  if (!form) return error('not_found', 'This form is not configured')
  if (form.enabled !== 1) {
    return error('unprocessable', 'This form is not accepting submissions right now')
  }

  // --- 5. silent drops (honeypot + too-fast) --------------------------------
  if (isBot(body)) return silentSuccess(form.success_message)
  const elapsed = typeof body.elapsedMs === 'number' ? body.elapsedMs : Number(body.elapsedMs)
  if (!Number.isFinite(elapsed) || elapsed < MIN_HUMAN_ELAPSED_MS) {
    return silentSuccess(form.success_message)
  }

  // --- 6. rate limit ---------------------------------------------------------
  const ip = clientIp(request)
  const ipHash = await hashIp(ip, env)
  const rate = await checkFormRateLimits(env, ipHash, slug)
  if (!rate.allowed) {
    return error('rate_limited', 'Too many submissions; try again shortly', {
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(rate.retryAfter))) },
    })
  }

  // --- 7. validate values against the field definitions ----------------------
  const defs = parseFieldDefs(form.fields)
  const { values, fieldErrors } = validateFieldValues(defs, body.values)
  if (Object.keys(fieldErrors).length > 0) {
    // Spec §4: validation failures are 400 with per-field messages, so a typo
    // never burns the one-time Turnstile token (checked after this step).
    return error('bad_request', 'Please check the highlighted fields.', {
      fields: Object.entries(fieldErrors).map(([path, message]) => ({ path, message })),
    })
  }
  if (Object.keys(values).length === 0) {
    return error('bad_request', 'Send at least one field value')
  }

  // --- 8. Turnstile ------------------------------------------------------------
  const turnstileOk = await verifyTurnstile(body.turnstileToken, request, env)
  if (!turnstileOk) {
    return error('forbidden', 'Captcha check failed; retry the widget')
  }

  // --- 9. duplicate guard ---------------------------------------------------------
  // Must be the exact string insertSubmissionV2 stores in search_text.
  const searchText = buildSearchText(values)
  if (await isRecentDuplicate(env, slug, ipHash, searchText)) {
    return silentSuccess(form.success_message)
  }

  // --- 10. INSERT + notifications ---------------------------------------------------
  const result = await insertSubmissionV2(env, slug, values, {
    context: cleanContext(body.context),
    ipHash,
    userAgent: request.headers.get('User-Agent'),
    sourceUrl: request.headers.get('Referer'),
    turnstileOk,
  })
  if (!result.ok) return result.response

  const submissionId = result.id
  context.waitUntil(
    (async () => {
      await notifyOwner(env, submissionId, form, values, cleanContext(body.context), defs)
      await sendAutoresponder(env, form, values)
    })(),
  )

  return json({ ok: true, message: form.success_message || 'Thanks — your message has been received.' }, { status: 201 })
}

/** A 201 that stores nothing: indistinguishable from a real success (§4 step 4). */
function silentSuccess(successMessage: string): Response {
  return json(
    { ok: true, message: successMessage || 'Thanks — your message has been received.' },
    { status: 201 },
  )
}

/** The honeypot: a real visitor never fills a hidden field named `website`. */
function isBot(body: SubmissionBody): boolean {
  const website = body.website
  if (typeof website === 'string' && website.trim() !== '') return true
  if (typeof website === 'boolean' && website) return true
  return false
}

function preflight(): Response {
  // Same-origin only: the site posts to itself. Keep the response small.
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/** Pages Function params may be `string | string[]`; a repeated segment is a 404. */
function asString(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

type SubmissionBody = {
  values?: unknown
  website?: string | boolean
  elapsedMs?: number | string
  turnstileToken?: string
  context?: unknown
}

type ReadResult =
  | { ok: true; body: SubmissionBody }
  | { ok: false; response: Response }

/** JSON body with the 32 KB cap (§4 step 1). */
async function readJson(request: Request): Promise<ReadResult> {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, response: error('bad_request', 'Send the body as application/json') }
  }

  const declaredLength = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, response: error('payload_too_large', 'Body is too large') }
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: error('bad_request', 'Body is not valid JSON') }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, response: error('bad_request', 'Body must be a JSON object') }
  }
  return { ok: true, body: raw as SubmissionBody }
}
