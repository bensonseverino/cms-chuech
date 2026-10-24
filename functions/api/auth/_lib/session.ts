import { error, type Env } from '@marino/api-kit'
import { sha256, tokenFrom, type SessionUser } from './auth'

/*
 * Session lookup shared by /api/auth/me and the admin middleware. It only
 * returns a user for a valid, unexpired, unrevoked token, so a stale or
 * missing cookie is *never* treated as a session.
 */

export type SessionState = {
  user: SessionUser
  sessionId: string | null
  passwordChanged: boolean
}

/** Returns a SessionState, or null for no/expired/revoked user. */
export async function sessionUserFrom(
  request: Request,
  env: Env,
): Promise<SessionState | null> {
  const token = tokenFrom(request)
  if (!token) return null
  const hash = await sha256(token)

  const row = await env.DB.prepare(
    `SELECT s.id, s.expires_at, s.revoked_at, u.id AS user_id, u.email, u.name, u.role,
            u.active, u.password_changed_at
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = @@
        AND s.revoked_at IS NULL
        AND datetime(s.expires_at) > datetime('now')`,
  )
    .bind(hash)
    .first<{
      id: string
      expires_at: string
      revoked_at: string | null
      user_id: string
      email: string
      name: string | null
      role: SessionUser['role']
      active: number
      password_changed_at: string | null
    }>()
    .catch((cause) => {
      console.error('[session] lookup failed', cause)
      return null
    })

  if (!row) return null
  await env.DB.prepare(
    'UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?',
  )
    .bind(row.user_id)
    .run()
  await env.DB.prepare(
    'UPDATE sessions SET last_used_at = datetime(\'now\'), expires_at = ? WHERE id = ?',
  )
    .bind(new Date(Date.now() + 30 * 86_400_000).toISOString(), row.id)
    .run()

  return {
    user: { id: row.user_id, email: row.email, name: row.name, role: row.role },
    sessionId: row.id,
    passwordChanged: row.password_changed_at !== null,
  }
  // The admin middleware re-checks role on every endpoint; this helper only
  // establishes identity.
}

export function unauthorized(message = 'Sign in to continue'): Response {
  return error('unauthorized', message)
}
