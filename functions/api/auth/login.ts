import {
  ADMIN_HEADERS,
  error,
  json,
  underRateLimit,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { login } from './_lib/auth'

/*
 * POST /api/auth/login — password login.
 * Rate limited at 5 wrong attempts/minute per client/IP + email pair, and the
 * client is also urged to honor `credentials: 'same-origin'`.
 */

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const ip =
    context.request.headers.get('CF-Connecting-IP') ??
    context.request.headers.get('X-Forwarded-For') ??
    'unknown'

  const body = await context.request.clone().text().catch(() => '')
  let emailKey = 'unknown'
  try {
    const parsed = JSON.parse(body) as { email?: unknown }
    if (typeof parsed.email === 'string') emailKey = parsed.email.trim().toLowerCase()
  } catch {
    // handled by the login endpoint itself
  }

  const allowed = await underRateLimit(context.env, `login:${ip}:${emailKey}`, 5, 60)
  if (!allowed) {
    return withHeaders(error('rate_limited', 'Too many attempts. Try again shortly.'), {
      status: 429,
    })
  }

  const result = await login(context.request, context.env)
  if (!result.ok) {
    // Keep the status body, but add the same admin-style safety headers.
    return withHeaders(result.response)
  }

  const user = {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role: result.user.role,
  }
  const response = json({ ok: true, user })
  response.headers.set('Set-Cookie', result.cookie)
  return withHeaders(response)
}

export const onRequestGet: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 405,
    headers: { Allow: 'POST' },
  })

function withHeaders(response: Response, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers ?? response.headers)
  for (const [key, value] of Object.entries(ADMIN_HEADERS)) headers.set(key, value)
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(response.body, { status: init?.status ?? response.status, headers })
}
