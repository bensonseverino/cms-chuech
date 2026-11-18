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
 * POST /api/admin/reviews/bulk — `{ ids, action: 'show'|'hide'|'feature'|
 * 'unfeature'|'delete' }` (forms-reviews spec §10).
 */

const FLAGS: Record<string, { column: string; value: number; label: string }> = {
  show: { column: 'is_visible', value: 1, label: 'Shown' },
  hide: { column: 'is_visible', value: 0, label: 'Hidden' },
  feature: { column: 'is_featured', value: 1, label: 'Featured' },
  unfeature: { column: 'is_featured', value: 0, label: 'Unfeatured' },
}

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const ids = stringArray(body.value.ids)
    if (!ids || ids.length === 0) return error('bad_request', 'Choose at least one review')
    if (ids.length > 200) return error('bad_request', 'At most 200 reviews per action')

    const unique = [...new Set(ids)]
    const action = body.value.action
    if (typeof action !== 'string') return error('bad_request', 'Missing bulk action')

    const placeholders = unique.map(() => '?').join(',')

    if (action === 'delete') {
      // Clear project pointers first so no project keeps a dead reference
      // (spec §10; mirrors the single delete).
      await context.env.DB.prepare(
        `UPDATE projects SET review_id = NULL WHERE review_id IN (${placeholders})`,
      )
        .bind(...unique)
        .run()
      await context.env.DB.prepare(`DELETE FROM reviews WHERE id IN (${placeholders})`)
        .bind(...unique)
        .run()

      await bumpContentVersion(context.env)
      await audit(
        context.env,
        actorOf(user),
        'bulk',
        'review',
        null,
        `Deleted ${unique.length} review${unique.length === 1 ? '' : 's'}`,
      )

      return json({ ok: true, updated: unique.length })
    }

    const flag = FLAGS[action]
    if (!flag) return error('bad_request', 'Unknown bulk action')

    await context.env.DB.prepare(
      `UPDATE reviews SET ${flag.column} = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
    )
      .bind(flag.value, ...unique)
      .run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'bulk',
      'review',
      null,
      `${flag.label} ${unique.length} review${unique.length === 1 ? '' : 's'}`,
    )

    return json({ ok: true, updated: unique.length })
  })
