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
import { listProjects, uniqueSlug } from '../_lib/projects'

/*
 * PUT /api/admin/projects/reorder — { ids: [...] } in display order.
 *
 * The whole list is required: a partial list would leave the untouched rows
 * interleaved at stale positions, which is not an order anyone asked for.
 */

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

    const existing = await context.env.DB.prepare('SELECT id FROM projects').all<{ id: string }>()
    const known = new Set((existing.results ?? []).map((row) => row.id))
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return error('bad_request', 'The order must list every project exactly once')
    }

    await context.env.DB.batch(
      ids.map((id, index) =>
        context.env.DB.prepare(
          `UPDATE projects SET position = ?, updated_at = datetime('now') WHERE id = ?`,
        ).bind(index, id),
      ),
    )

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'reorder', 'project', null, 'Reordered projects')

    return json({ items: await listProjects(context.env) })
  })

/** Reserved slugs must never be handed to a new project; kept here as the guard. */
export async function availableSlug(env: Env, desired: string): Promise<string> {
  return uniqueSlug(env, desired)
}
