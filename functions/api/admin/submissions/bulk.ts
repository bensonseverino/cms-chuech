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
 * read/unread changes are editor-level. Actions (forms-reviews spec §6):
 * read | unread | archive | spam | restore | delete.
 */

const STATUS_ACTIONS: Record<string, string> = {
  archive: 'archived',
  spam: 'spam',
  // `replied` is not in the bulk menu but the status selector shares the
  // shape, so it stays available here.
  replied: 'replied',
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

    // Read/unread touch `read_at` (and nudge `status` so the counts agree);
    // the other actions move `status` and clear the unread state.
    if (action === 'read' || action === 'unread') {
      await context.env.DB.prepare(
        `UPDATE submissions
            SET read_at = ${action === 'read' ? "COALESCE(read_at, datetime('now'))" : 'NULL'},
                status = CASE WHEN status ${action === 'read' ? "= 'new'" : "= 'read'"}
                              THEN '${action === 'read' ? 'read' : 'new'}' ELSE status END,
                handled_by = ?, updated_at = datetime('now')
          WHERE id IN (${placeholders})`,
      )
        .bind(action === 'read' ? user.id : null, ...unique)
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
    }

    const status = STATUS_ACTIONS[action]
    if (action === 'restore' || status) {
      // Restore sends rows back to the top of the inbox as unread.
      const nextStatus = action === 'restore' ? 'new' : status
      await context.env.DB.prepare(
        `UPDATE submissions
            SET status = ?, read_at = NULL, handled_by = ?, updated_at = datetime('now')
          WHERE id IN (${placeholders})`,
      )
        .bind(nextStatus, user.id, ...unique)
        .run()

      await audit(
        context.env,
        actorOf(user),
        'bulk',
        'submission',
        null,
        `${action === 'restore' ? 'Restored' : `Marked ${action}`} ${unique.length} submission${unique.length === 1 ? '' : 's'}`,
      )

      return json({ ok: true, updated: unique.length })
    }

    return error('bad_request', 'Unknown bulk action')
  })
