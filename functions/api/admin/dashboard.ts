import { hasRole, json, type Env, type PagesFunction } from '@marino/api-kit'
import { currentUser } from './_lib/db'
import { run } from './_lib/http'

/*
 * GET /api/admin/dashboard — the four cards and the two lists.
 *
 * Counts are deliberately cheap aggregate queries. "Unpublished changes" means
 * a draft that differs from its last snapshot (or has never been published), so
 * a brand-new empty draft counts too: it still has work the public cannot see.
 */

type RecentSubmission = {
  id: string
  source: string
  form_label: string | null
  status: string
  name: string | null
  email: string | null
  message: string | null
  created_at: string
}

type RecentAudit = {
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
    const env = context.env
    const user = currentUser(context)
    const canViewAudit = hasRole(user, 'admin')

    const [
      newSubmissions,
      changedDocuments,
      changedEntries,
      draftDocuments,
      draftEntries,
      mediaBytes,
      recentSubmissions,
      recentAudit,
    ] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS count FROM submissions WHERE status = 'new'`).first<{
        count: number
      }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM documents
          WHERE published_data IS NULL OR data != published_data`,
      ).first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM entries
          WHERE published_data IS NULL OR data != published_data`,
      ).first<{ count: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM documents WHERE status = 'draft'`).first<{
        count: number
      }>(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM entries WHERE status = 'draft'`).first<{
        count: number
      }>(),
      env.DB.prepare(
        `SELECT COALESCE(SUM(size), 0) AS bytes FROM media WHERE deleted_at IS NULL`,
      ).first<{ bytes: number }>(),
      env.DB.prepare(
        `SELECT s.id, s.source, f.label AS form_label, s.status, s.name, s.email, s.message, s.created_at
           FROM submissions s LEFT JOIN forms f ON f.source = s.source
          ORDER BY s.created_at DESC, s.id DESC LIMIT 5`,
      ).all<RecentSubmission>(),
      env.DB.prepare(
        `SELECT id, user_email, action, entity_type, entity_id, summary, created_at
           FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 8`,
      ).all<RecentAudit>(),
    ])

    return json({
      cards: {
        newSubmissions: newSubmissions?.count ?? 0,
        unpublishedChanges: (changedDocuments?.count ?? 0) + (changedEntries?.count ?? 0),
        drafts: (draftDocuments?.count ?? 0) + (draftEntries?.count ?? 0),
        mediaBytes: mediaBytes?.bytes ?? 0,
      },
      recentSubmissions: (recentSubmissions.results ?? []).map((row) => ({
        id: row.id,
        source: row.source,
        formLabel: row.form_label,
        status: row.status,
        name: row.name,
        email: row.email,
        message: row.message,
        createdAt: row.created_at,
      })),
      recentAudit: canViewAudit
        ? (recentAudit.results ?? []).map((row) => ({
            id: row.id,
            userEmail: row.user_email,
            action: row.action,
            entityType: row.entity_type,
            entityId: row.entity_id,
            summary: row.summary,
            createdAt: row.created_at,
          }))
        : [],
    })
  })
