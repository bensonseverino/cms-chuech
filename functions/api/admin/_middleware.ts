import {
  ADMIN_HEADERS,
  error,
  getUser,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { sessionUserFrom } from '../auth/_lib/session'

/*
 * The admin gate.
 *
 * Cloudflare Access is the front door, but the API proves the caller on every
 * request as well. This middleware is the only place that turns a request into
 * a `context.data.user`; every endpoint below it can therefore assume an
 * identified, active user and only has to decide whether their role is enough.
 *
 * `/api/admin/health` is deliberately exempt from the identity lookup: it is
 * the endpoint used when auth or bindings are themselves broken, and it leaks
 * no data. Access still protects the hostname.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return withAdminHeaders(new Response(null, { status: 204 }))
  }

  if (url.pathname === '/api/admin/health' && request.method === 'GET') {
    return withAdminHeaders(await context.next())
  }

  // Password sessions have first class. If present, they establish identity
  // before Cloudflare Access does and possibly *without* Access at all.
  const sessionUser = await sessionUserFrom(request, env)
  if (sessionUser) {
    context.data.user = sessionUser.user
    // Keep running the CSRF/origin checks below so mutations are still gated,
    // but skip the Access JWT/DEV_USER_EMAIL bootstrap so the session path can
    // be used standalone (e.g. on preview hostnames without Access policies).
    const csrf = checkMutationRequest(request, env)
    if (csrf) return withAdminHeaders(csrf)
    return withAdminHeaders(await context.next())
  }

  const auth = await getUser(request, env)
  if (!auth.ok) return withAdminHeaders(auth.response)

  if (MUTATING.has(request.method)) {
    const csrf = checkMutationRequest(request, env)
    if (csrf) return withAdminHeaders(csrf)
  }

  context.data.user = auth.user
  return withAdminHeaders(await context.next())
}

function checkMutationRequest(request: Request, env: Env): Response | null {
  const requestedWith = request.headers.get('X-Requested-With') ?? ''
  if (requestedWith.toLowerCase() !== 'xmlhttprequest') {
    return error(
      'forbidden',
      'Mutations must be sent by the CMS client (missing X-Requested-With header)',
    )
  }

  const origin = request.headers.get('Origin')
  if (!origin) return error('forbidden', 'Mutations must include an Origin header')

  const requestOrigin = new URL(request.url).origin
  const candidates = [requestOrigin]
  if (env.CMS_ORIGIN && /^https?:\/\//i.test(env.CMS_ORIGIN)) {
    candidates.push(env.CMS_ORIGIN)
  }

  const normalisedOrigin = normalise(origin)
  if (candidates.some((candidate) => normalise(candidate) === normalisedOrigin)) return null

  // Vite's dev proxy keeps the browser Origin (:5174) while the Function is
  // served on :8788. The dev bypass is confined to loopback; production never
  // reaches this branch.
  if (env.DEV_USER_EMAIL && isLoopback(requestOrigin) && isLoopback(origin)) return null

  return error('forbidden', 'Origin does not match the CMS origin')
}

function withAdminHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(ADMIN_HEADERS)) headers.set(key, value)
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return new Response(response.body, { status: response.status, headers })
}

function normalise(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase()
}

function isLoopback(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    )
  } catch {
    return false
  }
}
