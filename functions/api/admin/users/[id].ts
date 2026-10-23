import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { ROLES, loadUser, otherActiveAdmins, userView } from '../_lib/users'
import { isObject, readJsonBody, run } from '../_lib/http'

/*
 * PATCH  /api/admin/users/:id — name, role, active (admin only)
 * DELETE /api/admin/users/:id — deactivate (admin only)
 *
 * The last active admin can neither demote themselves nor be deactivated from
 * another session, otherwise the CMS would lock its own front door.
 */

export const onRequestPatch: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const id = context.params.id
    if (!id) return error('bad_request', 'Missing user id')

    const row = await loadUser(context.env, id)
    if (!row) return error('not_found', 'No such user')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const role =
      body.value.role === undefined
        ? row.role
        : typeof body.value.role === 'string'
          ? body.value.role
          : ''
    if (!ROLES.has(role)) return error('bad_request', 'Role must be admin, editor or viewer')

    let active = row.active === 1
    if (body.value.active !== undefined) {
      if (typeof body.value.active !== 'boolean') {
        return error('bad_request', '`active` must be a boolean')
      }
      active = body.value.active
    }

    const name =
      body.value.name === undefined
        ? row.name
        : body.value.name === null
          ? null
          : typeof body.value.name === 'string'
            ? body.value.name.trim().slice(0, 120) || null
            : undefined
    if (name === undefined) return error('bad_request', '`name` must be a string or null')

    if (id === user.id && (role !== 'admin' || !active)) {
      return error('bad_request', 'You cannot remove your own admin access or deactivate yourself')
    }

    if (row.role === 'admin' && row.active === 1 && (role !== 'admin' || !active)) {
      const others = await otherActiveAdmins(context.env, id)
      if (others === 0) return error('conflict', 'At least one active admin is required')
    }

    await context.env.DB.prepare(
      'UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?',
    )
      .bind(name, role, active ? 1 : 0, id)
      .run()

    await audit(
      context.env,
      actorOf(user),
      'update',
      'user',
      id,
      `Updated ${row.email}: ${role}${active ? '' : ' (deactivated)'}`,
    )

    const updated = await loadUser(context.env, id)
    if (!updated) return error('server_error', 'The user could not be read back')
    return json({ item: userView(updated) })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const id = context.params.id
    if (!id) return error('bad_request', 'Missing user id')

    const row = await loadUser(context.env, id)
    if (!row) return error('not_found', 'No such user')

    if (id === user.id) return error('bad_request', 'You cannot deactivate your own account')

    if (row.role === 'admin' && row.active === 1) {
      const others = await otherActiveAdmins(context.env, id)
      if (others === 0) return error('conflict', 'At least one active admin is required')
    }

    await context.env.DB.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(id).run()
    await audit(context.env, actorOf(user), 'delete', 'user', id, `Deactivated ${row.email}`)

    return json({ ok: true })
  })
