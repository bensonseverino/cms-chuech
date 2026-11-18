import { json, type Env, type PagesFunction } from '@marino/api-kit'
import { run } from '../_lib/http'

/*
 * GET /api/admin/submissions/unread-count — `{ count: n }` for the sidebar
 * badge (forms-reviews spec §7). Unread means `read_at IS NULL`; archived and
 * spam rows do not call the user back to the inbox, so they stay out of the
 * badge. Polled every 60 s and on window focus.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const row = await context.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM submissions
        WHERE read_at IS NULL AND status NOT IN ('spam', 'archived')`,
    ).first<{ count: number }>()

    return json({ count: row?.count ?? 0 })
  })
