import { json, newId, type Env, type PagesFunction } from '@marino/api-kit'
import { audit } from '@marino/api-kit'
import { hashPassword, verify } from './_lib/auth'
import { sessionUserFrom } from './_lib/session'

/* PATCH /api/auth/password — change password for the signed-in user. */

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const state = await sessionUserFrom(context.request, context.env)
  if (!state) {
    return json({ error: { code: 'unauthorized', message: 'Not signed in' } }, { status: 401 })
  }

  const text = await context.request.text().catch(() => '')
  let parsed: { currentPassword?: unknown; newPassword?: unknown }
  try {
    parsed = JSON.parse(text) as { currentPassword?: unknown; newPassword?: unknown }
  } catch {
    return json({ error: { code: 'bad_request', message: 'Send the body as application/json' } }, { status: 400 })
  }

  const current = typeof parsed.currentPassword === 'string' ? parsed.currentPassword : ''
  const next = typeof parsed.newPassword === 'string' ? parsed.newPassword : ''
  if (!current || !next) {
    return json(
      { error: { code: 'bad_request', message: 'Current and new password are required' } },
      { status: 400 },
    )
  }
  if (next.length < 8 || next.length > 128) {
    return json(
      { error: { code: 'unprocessable', message: 'Use a password of 8–128 characters' } },
      { status: 422 },
    )
  }
  if (next === current) {
    return json({ error: { code: 'bad_request', message: 'Choose a different password' } }, { status: 400 })
  }

  const row = await context.env.DB.prepare(
    'SELECT password_hash, password_salt FROM users WHERE id = ?',
  )
    .bind(state.user.id)
    .first<{ password_hash: string | null; password_salt: string | null }>()

  if (!row?.password_hash || !row.password_salt) {
    await auditLog(context.env, state.user.email, 'update', 'user', state.user.id, 'Password reset without a stored password')
    await setPassword(context.env, state.user.id, next)
    return json({ ok: true })
  }

  const okCurrent = await verify(current, row.password_hash, row.password_salt)
  if (!okCurrent) {
    await auditLog(context.env, state.user.email, 'login', 'user', state.user.id, 'Failed password change')
    return json({ error: { code: 'unauthorized', message: 'Current password is incorrect' } }, { status: 401 })
  }

  const hashed = await hashPassword(next)
  if (!hashed) {
    return json({ error: { code: 'server_error', message: 'Could not update password' } }, { status: 500 })
  }

  await context.env.DB.prepare(
    'UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = datetime(\'now\') WHERE id = ?',
  )
    .bind(hashed.hash, hashed.salt, state.user.id)
    .run()

  await auditLog(context.env, state.user.email, 'update', 'user', state.user.id, 'Changed own password')
  return json({ ok: true })
}

function setPassword(env: Env, id: string, password: string) {
  return hashPassword(password).then((hashed: Awaited<ReturnType<typeof hashPassword>>) => {
    if (!hashed) throw new Error('Password hashing failed')
    return env.DB.prepare(
      'UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = datetime(\'now\') WHERE id = ?',
    )
      .bind(hashed.hash, hashed.salt, id)
      .run()
  })
}

function auditLog(env: Env, email: string, action: 'update' | 'login', typeId: string, id: string, summary: string) {
  return audit(env, { email }, action, typeId, id, summary).then(() => newId()) // non-blocking
}

export async function logLoginAttempt(
  env: Env,
  email: string | null,
  contextIp: string,
  contextEmail: string,
): Promise<void> {
  await audit(
    env,
    email ? { email } : null,
    'login',
    'user',
    null,
    `Attempted login for ${contextEmail} from ${contextIp}`,
  )
}

