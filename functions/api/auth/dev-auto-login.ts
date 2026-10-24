import { error, json, type Env, type PagesFunction } from '@marino/api-kit'
import { login } from './_lib/auth'

/*
 * POST /api/auth/dev-auto-login — development convenience only.
 * It both:
 *   - never exists in production (it returns 404), and
 *   - if AUTO_LOGIN is accidentally true in production, makes every request
 *     through /api/auth/* fail loudly instead of silently going through.
 */

const DEV_ORIGIN = 'http://127.0.0.1:5174'
const HOSTS = new Set(['localhost', '127.0.0.1'])

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context
  let hostname = ''
  try {
    hostname = new URL(request.url).hostname
  } catch {
    hostname = ''
  }

  const isDev = env.ENV === 'development' || env.DEV_USER_EMAIL
  const originAllowed = isLoopback(
    request.headers.get('Origin') ?? `http://${hostname}`,
  )
  if (!isDev || env.AUTO_LOGIN !== 'true' || !HOSTS.has(hostname) || !originAllowed) {
    return new Response(null, { status: 404 })
  }

  if (env.ENV === 'production' && env.AUTO_LOGIN === 'true') {
    console.error('AUTO_LOGIN must not be enabled in production')
    return error('server_error', 'AUTO_LOGIN must not be enabled in production')
  }

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    return error('bad_request', 'Owner credentials are not configured locally')
  }

  // Re-use the normal login path: it has rate limiting, session creation and
  // audit logging. The constructed `Request` never leaves the worker.
  const loginRequest = new Request(request.url, {
    method: 'POST',
    headers: { Origin: DEV_ORIGIN, 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
  })
  const result = await login(loginRequest, env)
  if (!result.ok) return result.response

  const response = json({ ok: true, user: { id: result.user.id, email: result.user.email, role: result.user.role } })
  response.headers.set('Set-Cookie', result.cookie)
  return response
}

function isLoopback(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}
