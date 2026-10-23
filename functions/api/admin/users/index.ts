import {
  audit,
  error,
  json,
  newId,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { EMAIL, ROLES, USER_SELECT, userView, type UserRow } from '../_lib/users'
import { isObject, readJsonBody, run } from '../_lib/http'

/*
 * GET  /api/admin/users — CMS roles (admin only)
 * POST /api/admin/users — invite an email
 *
 * Access decides who can reach the CMS; this table decides what they may do.
 * Adding a user here does not add an Access policy, and the Users screen says
 * so explicitly.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const { results } = await context.env.DB.prepare(
      `${USER_SELECT} ORDER BY active DESC, role, email COLLATE NOCASE`,
    ).all<UserRow>()

    return json({ items: (results ?? []).map(userView) })
  })

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const email = typeof body.value.email === 'string' ? body.value.email.trim().toLowerCase() : ''
    if (!email || email.length > 320 || !EMAIL.test(email)) {
      return error('bad_request', 'Enter a valid email address')
    }

    const role = typeof body.value.role === 'string' ? body.value.role : ''
    if (!ROLES.has(role)) return error('bad_request', 'Role must be admin, editor or viewer')

    const name =
      typeof body.value.name === 'string' && body.value.name.trim().length > 0
        ? body.value.name.trim().slice(0, 120)
        : null

    const existing = await context.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE',
    )
      .bind(email)
      .first<{ id: string }>()
    if (existing) return error('conflict', 'That email is already a CMS user')

    const id = newId()
    await context.env.DB.prepare(
      'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)',
    )
      .bind(id, email, name, role)
      .run()

    await audit(context.env, actorOf(user), 'create', 'user', id, `Invited ${email} as ${role}`)

    const row = await context.env.DB.prepare(`${USER_SELECT} WHERE id = ?`)
      .bind(id)
      .first<UserRow>()

    if (!row) return error('server_error', 'The user was created but could not be read back')
    return json({ item: userView(row) }, { status: 201 })
  })
