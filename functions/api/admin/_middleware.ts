import {
  ADMIN_HEADERS,
  error,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { sessionUserFrom } from '../auth/_lib/session'

/*
 * The admin gate.
 *
 * One identity source: the `cms_session` cookie from POST /api/auth/login. A
 * request with no valid session for an active user is rejected here, so every
 * endpoint below this middleware can assume an identified user and only has to
 * decide whether their role is enough.
 *
 * `/api/admin/health` is deliberately exempt from the identity lookup: it is
 * the endpoint used when auth or bindings are themselves broken, and it leaks
 * no data.
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

  const sessionUser = await sessionUserFrom(request, env)
  if (!sessionUser) {
    return withAdminHeaders(error('unauthorized', 'Sign in to continue'))
  }
  context.data.user = sessionUser.user

  // Guard mutations only: a read must never require the CSRF header, or the
  // SPA's plain GETs (e.g. /api/admin/me) would 403.
  if (MUTATING.has(request.method)) {
    const csrf = checkMutationRequest(request, env)
    if (csrf) return withAdminHeaders(csrf)
  }

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
  // served on :8788. The dev allowance is confined to loopback hosts and to
  // ENV=development; production never reaches this branch.
  if (
    env.ENV === 'development' &&
    isLoopback(requestOrigin) &&
    isLoopback(origin)
  ) {
    return null
  }

  return error('forbidden', 'Origin does not match the CMS origin')
}

function withAdminHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(ADMIN_HEADERS)) headers.set(key, value)
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Submissions and inbox data must never be cached (forms-reviews spec §13).
  headers.set('Cache-Control', 'no-store')
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
