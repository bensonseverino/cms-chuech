import { json, type Env, type PagesFunction } from '@marino/api-kit'
import { run } from '../_lib/http'

/*
 * GET /api/admin/submissions/sources
 *
 * The inbox filter needs source labels for every role that can read the inbox.
 * Form management stays admin-only; this endpoint only exposes the source name,
 * label and count.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const { results } = await context.env.DB.prepare(
      `SELECT f.source AS source,
              COALESCE(f.label, f.source) AS label,
              COUNT(s.id) AS count
         FROM forms f
         LEFT JOIN submissions s ON s.source = f.source
        GROUP BY f.source, f.label
        ORDER BY label COLLATE NOCASE`,
    ).all<{ source: string; label: string; count: number }>()

    return json({ items: results ?? [] })
  })
