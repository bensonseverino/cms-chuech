import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run, stringArray } from '../_lib/http'

/*
 * POST /api/admin/submissions/bulk
 *
 * One endpoint for the inbox's bulk menu. Deletion is admin-only; status and
 * read/unread changes are editor-level.
 */

const STATUS_ACTIONS: Record<string, string> = {
  read: 'read',
  unread: 'new',
  replied: 'replied',
  spam: 'spam',
  archived: 'archived',
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
    if (!ids || ids.length === 0) return error('bad_request', 'Choose at least one submission')
    if (ids.length > 500) return error('bad_request', 'At most 500 submissions per action')

    const unique = [...new Set(ids)]
    const action = body.value.action
    if (typeof action !== 'string') return error('bad_request', 'Missing bulk action')

    const placeholders = unique.map(() => '?').join(',')

    if (action === 'delete') {
      const adminError = requireRole(user, 'admin')
      if (adminError) return adminError

      await context.env.DB.prepare(
        `DELETE FROM submissions WHERE id IN (${placeholders})`,
      )
        .bind(...unique)
        .run()

      await audit(
        context.env,
        actorOf(user),
        'bulk',
        'submission',
        null,
        `Deleted ${unique.length} submission${unique.length === 1 ? '' : 's'}`,
      )

      return json({ ok: true, updated: unique.length })
    }

    const status = STATUS_ACTIONS[action]
    if (!status) return error('bad_request', 'Unknown bulk action')

    await context.env.DB.prepare(
      `UPDATE submissions
          SET status = ?, handled_by = ?, updated_at = datetime('now')
        WHERE id IN (${placeholders})`,
    )
      .bind(status, user.id, ...unique)
      .run()

    await audit(
      context.env,
      actorOf(user),
      'bulk',
      'submission',
      null,
      `Marked ${unique.length} submission${unique.length === 1 ? '' : 's'} ${action}`,
    )

    return json({ ok: true, updated: unique.length })
  })
