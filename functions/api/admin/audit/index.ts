import { json, requireRole, type Env, type PagesFunction } from '@marino/api-kit'
import { currentUser } from '../_lib/db'
import { pageParams, run } from '../_lib/http'

/*
 * GET /api/admin/audit — who changed what (admin only).
 */

type AuditRow = {
  id: string
  user_email: string
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  created_at: string
}

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const url = new URL(context.request.url)
    const { page, limit, offset } = pageParams(url, 50, 200)
    const action = url.searchParams.get('action')?.trim()
    const entityType = url.searchParams.get('entityType')?.trim()
    const actor = url.searchParams.get('user')?.trim()

    const conditions: string[] = []
    const bindings: unknown[] = []

    if (action) {
      conditions.push('action = ?')
      bindings.push(action)
    }
    if (entityType) {
      conditions.push('entity_type = ?')
      bindings.push(entityType)
    }
    if (actor) {
      conditions.push('user_email = ? COLLATE NOCASE')
      bindings.push(actor)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const [count, rows] = await Promise.all([
      context.env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_log ${where}`)
        .bind(...bindings)
        .first<{ count: number }>(),
      context.env.DB.prepare(
        `SELECT id, user_email, action, entity_type, entity_id, summary, created_at
           FROM audit_log ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(...bindings, limit, offset)
        .all<AuditRow>(),
    ])

    return json({
      items: (rows.results ?? []).map((row) => ({
        id: row.id,
        userEmail: row.user_email,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        createdAt: row.created_at,
      })),
      total: count?.count ?? 0,
      page,
      limit,
    })
  })
