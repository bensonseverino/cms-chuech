import { audit, error, newId } from '@marino/api-kit'
import type { Env } from '@marino/api-kit'

/*
 * Shared helpers for the new password-session auth (`cms-auto-login-spec.md`).
 * The admin API still has its own Cloudflare Access path; password login only
 * adds an alternative way into the same role-check code.
 */

export type PasswordUser = {
  id: string
  email: string
  name: string | null
  role: string
  active: number
  password_hash: string | null
  password_salt: string | null
  password_changed_at: string | null
}

export type SessionUser = {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'editor' | 'viewer'
}

export type LoginAttempt = { ok: true; user: PasswordUser; cookie: string } | {
  ok: false
  response: Response
}

const SESSION_COOKIE = 'cms_session'
const SESSION_TTL_DAYS = 30
const PBKDF2_ITERATIONS = 210_000

/** Audit log helper; audit never fails the caller. */
function logAudit(
  env: Env,
  actorId: string | null,
  email: string,
  action: 'login' | 'logout',
  entityType: string,
  entityId: string | null,
  summary: string,
): Promise<void> {
  const actor = actorId ? { email } : null
  return audit(env, actor, action, entityType, entityId, summary)
}

/**
 * Login, one shared PBKDF2 routine for every password. All inputs are bound
 * parameters; the token itself is never stored anywhere but the client cookie.
 */
export async function login(
  request: Request,
  env: Env,
): Promise<LoginAttempt> {
  const body = await readBody(request)
  if (typeof body !== 'object' || body === null) {
    return { ok: false, response: error('bad_request', 'Send the body as application/json') }
  }

  const value = body as Record<string, unknown>
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : ''
  const password = typeof value.password === 'string' ? value.password : ''
  if (!email || !password) {
    return { ok: false, response: error('bad_request', 'Email and password are required') }
  }

  if (!isOriginAllowed(request)) {
    return { ok: false, response: error('forbidden', 'Origin does not match the CMS origin') }
  }

  const identity = await findUser(env, email)
  if (!identity) {
    await logAudit(env, null, email, 'login', 'user', null, 'Failed login attempt')
    return { ok: false, response: error('unauthorized', 'Incorrect email or password') }
  }

  if (identity.active !== 1) {
    await logAudit(env, identity.id, identity.email, 'login', 'user', identity.id, 'Attempted login by a deactivated user')
    return { ok: false, response: error('forbidden', 'This account has been deactivated') }
  }

  if (!identity.password_hash || !identity.password_salt) {
    await logAudit(env, identity.id, identity.email, 'login', 'user', identity.id, 'Account has no password set')
    return { ok: false, response: error('unauthorized', 'Incorrect email or password') }
  }

  const okPassword = await verify(password, identity.password_hash, identity.password_salt)
  if (!okPassword) {
    await logAudit(env, identity.id, identity.email, 'login', 'user', identity.id, 'Failed login attempt')
    return { ok: false, response: error('unauthorized', 'Incorrect email or password') }
  }

  const token = randomToken()
  const cookie = await createSessionCookie(env, identity.id, token)
  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(identity.id).run()
  await logAudit(env, identity.id, identity.email, 'login', 'user', identity.id, 'Signed in by password')

  return {
    ok: true,
    user: identity,
    cookie,
  }
}

export function sessionCookieToken(token: string): string {
  return token
}

/* Find a user without ever exposing password bytes outside this module. */
async function findUser(env: Env, email: string): Promise<PasswordUser | null> {
  return env.DB.prepare(
    'SELECT id, email, name, role, active, password_hash, password_salt, password_changed_at FROM users WHERE email = ? COLLATE NOCASE',
  )
    .bind(email)
    .first<PasswordUser>()
}

/**
 * A session token is a random 32-byte string; D1 only stores its SHA-256.
 * `token` itself never leaves this module except appended to the client cookie.
 */
function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const hexBytes = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return hexBytes.join('')
}

async function createSessionCookie(
  env: Env,
  userId: string,
  token: string,
): Promise<string> {
  const tokenHash = await sha256(token)
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString()
  const id = newId()

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, userId, tokenHash, expires)
    .run()

  const secure =
    env.ENV !== 'development' &&
    new URL(env.CMS_ORIGIN ?? 'http://localhost:8788').protocol === 'https:'
  const flags = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`
  return secure ? `${flags}; Secure` : flags
}

export async function verify(entry: string, storedHash: string, storedSalt: string): Promise<boolean> {
  const candidate = await deriveBits(entry, storedSalt)
  if (typeof candidate !== 'string') return false
  return constantTimeEqual(candidate, storedHash)
}

/**
 * Hash a password for storage/update. Exposed for the change-password screen.
 */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string } | null> {
  const salt = randomToken().slice(0, 16)
  const hash = await deriveBits(password, salt)
  return hash ? { hash, salt } : null
}

async function deriveBits(password: string, salt: string): Promise<string | null> {
  // Standard PBKDF2 semantics — identical to Node's
  // pbkdf2Sync(password, salt, iterations, 32, 'sha256') used by the seed
  // script, so hashes computed either way verify here.
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )

  try {
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(salt),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      key,
      256,
    )
    return hex(new Uint8Array(bits))
  } catch (cause) {
    console.error('[auth] PBKDF2 derive failed', cause)
    return null
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

export async function sha256(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return hex(new Uint8Array(bytes))
}

function normalise(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase()
}

function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return false
  const requestOrigin = new URL(request.url).origin
  if (normalise(origin) === normalise(requestOrigin)) return true
  // Local dev proxies keep the SPA origin, so loopback origins are accepted.
  const loopback = [
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:8788',
    'http://127.0.0.1:8788',
  ]
  return loopback.includes(normalise(origin))
}

export async function readBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text()
    if (!text) return null
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Reads `cms_session` from the request cookies, if present. */
export function tokenFrom(request: Request): string | null {
  const raw = request.headers.get('Cookie')
  if (!raw) return null
  const match = raw
    .split(/;\s*/)
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  if (!match) return null
  return match.split('=')[1] ?? null
}

/** Invalidate any matching session row and send an empty cookie. */
export async function logout(request: Request, env: Env): Promise<Response> {
  const token = tokenFrom(request)
  if (!token) return plainOk('No active session')
  const tokenHash = await sha256(token)
  const row = await env.DB.prepare(
    'SELECT id, user_id FROM sessions WHERE token_hash = ? AND revoked_at IS NULL',
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: string }>()

  if (row) {
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(row.user_id)
      .first<{ email: string }>()
    await env.DB.prepare('UPDATE sessions SET revoked_at = datetime(\'now\') WHERE id = ?').bind(row.id).run()
    if (user) {
      await logAudit(env, row.user_id, user.email, 'logout', 'user', row.user_id, 'Signed out')
    }
  }

  return plainOk('Signed out', clearCookie)
}

const clearCookie = `${SESSION_COOKIE}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`

const plainOk = (message: string, cookie?: string): Response =>
  new Response(
    JSON.stringify({ ok: true, message }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(cookie ? { 'Set-Cookie': cookie } : {}),
      },
    },
  )
