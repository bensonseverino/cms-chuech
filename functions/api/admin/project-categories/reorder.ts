import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run } from '../_lib/http'

/* PUT /api/admin/project-categories/reorder — { ids: [...] } in display order. */

export const onRequestPut: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value) || !Array.isArray(body.value.ids)) {
      return error('bad_request', 'Send { ids: string[] }')
    }

    const ids = body.value.ids
    if (!ids.every((id): id is string => typeof id === 'string' && id.length > 0)) {
      return error('bad_request', 'Every id must be a non-empty string')
    }
    if (new Set(ids).size !== ids.length) return error('bad_request', 'Duplicate ids in the order')

    const existing = await context.env.DB.prepare('SELECT id FROM project_categories').all<{
      id: string
    }>()
    const known = new Set((existing.results ?? []).map((row) => row.id))
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return error('bad_request', 'The order must list every category exactly once')
    }

    await context.env.DB.batch(
      ids.map((id, index) =>
        context.env.DB.prepare(
          `UPDATE project_categories SET position = ?, updated_at = datetime('now') WHERE id = ?`,
        ).bind(index, id),
      ),
    )

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'reorder', 'project_category', null, 'Reordered categories')

    const { results } = await context.env.DB.prepare(
      `SELECT id, slug, label, position FROM project_categories
        ORDER BY position ASC, label ASC`,
    ).all<{ id: string; slug: string; label: string; position: number }>()

    return json({ items: results ?? [] })
  })
