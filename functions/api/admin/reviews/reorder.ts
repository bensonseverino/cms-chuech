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
import { isObject, readJsonBody, run, stringArray } from '../_lib/http'

/*
 * PUT /api/admin/reviews/reorder — `{ ids: string[] }` in the desired site
 * order. The drag-and-drop list sends the full order after each drop; positions
 * are renumbered in tens so later insertions stay cheap (forms-reviews spec §10).
 */

export const onRequestPut: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const ids = stringArray(body.value.ids)
    if (!ids) return error('bad_request', '`ids` must be an array of review ids')

    const unique = [...new Set(ids)]
    if (unique.length === 0) return error('bad_request', 'Choose at least one review')

    // Every id must exist: a stale list would silently drop rows from the order.
    const placeholders = unique.map(() => '?').join(',')
    const { results } = await context.env.DB.prepare(
      `SELECT id FROM reviews WHERE id IN (${placeholders})`,
    )
      .bind(...unique)
      .all<{ id: string }>()
    if ((results ?? []).length !== unique.length) {
      return error('bad_request', 'That order includes an unknown review')
    }

    const statement = context.env.DB.prepare('UPDATE reviews SET position = ?, updated_at = datetime(\'now\') WHERE id = ?')
    await context.env.DB.batch(
      unique.map((id, index) => statement.bind((index + 1) * 10, id)),
    )

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'reorder',
      'review',
      null,
      `Reordered ${unique.length} review${unique.length === 1 ? '' : 's'}`,
    )

    return json({ ok: true })
  })
