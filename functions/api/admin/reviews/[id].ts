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
import {
  parseReviewInput,
  projectsUsingReview,
  REVIEW_SELECT,
  reviewView,
  type ReviewRow,
} from '../_lib/reviews'

/*
 * GET    /api/admin/reviews/:id — one review plus the projects that use it
 * PUT    /api/admin/reviews/:id — edit the quote, attribution, flags
 * DELETE /api/admin/reviews/:id — delete; project pointers are cleared, not blocked
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const id = String(context.params.id ?? '')
    const row = await context.env.DB.prepare(`${REVIEW_SELECT} WHERE r.id = ?`)
      .bind(id)
      .first<ReviewRow>()
    if (!row) return error('not_found', 'No such review')

    return json({ item: reviewView(row), usedBy: await projectsUsingReview(context.env, id) })
  })

export const onRequestPut: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const row = await context.env.DB.prepare(`${REVIEW_SELECT} WHERE r.id = ?`)
      .bind(id)
      .first<ReviewRow>()
    if (!row) return error('not_found', 'No such review')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    // Partial update: absent fields keep their stored values.
    const merged = {
      quote: body.value.quote !== undefined ? body.value.quote : row.quote,
      authorName: body.value.authorName !== undefined ? body.value.authorName : row.author_name,
      authorRole: body.value.authorRole !== undefined ? body.value.authorRole : row.author_role,
      company: body.value.company !== undefined ? body.value.company : row.company,
      avatar: body.value.avatar !== undefined ? body.value.avatar : row.avatar,
      rating: body.value.rating !== undefined ? body.value.rating : row.rating,
      source: body.value.source !== undefined ? body.value.source : row.source,
      sourceUrl: body.value.sourceUrl !== undefined ? body.value.sourceUrl : row.source_url,
      reviewedAt: body.value.reviewedAt !== undefined ? body.value.reviewedAt : row.reviewed_at,
    }

    const parsed = parseReviewInput(merged)
    if (!parsed.ok) return parsed.response
    const input = parsed.input

    let isFeatured = row.is_featured === 1
    if (body.value.isFeatured !== undefined) {
      if (typeof body.value.isFeatured !== 'boolean') {
        return error('bad_request', '`isFeatured` must be a boolean')
      }
      isFeatured = body.value.isFeatured
    }

    let isVisible = row.is_visible === 1
    if (body.value.isVisible !== undefined) {
      if (typeof body.value.isVisible !== 'boolean') {
        return error('bad_request', '`isVisible` must be a boolean')
      }
      isVisible = body.value.isVisible
    }

    await context.env.DB.prepare(
      `UPDATE reviews
          SET quote = ?, author_name = ?, author_role = ?, company = ?, avatar = ?,
              rating = ?, source = ?, source_url = ?, reviewed_at = ?,
              is_featured = ?, is_visible = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(
        input.quote,
        input.authorName,
        input.authorRole,
        input.company,
        input.avatar,
        input.rating,
        input.source,
        input.sourceUrl,
        input.reviewedAt,
        isFeatured ? 1 : 0,
        isVisible ? 1 : 0,
        id,
      )
      .run()

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'update', 'review', id, `Updated the review from '${input.authorName}'`)

    const updated = await context.env.DB.prepare(`${REVIEW_SELECT} WHERE r.id = ?`)
      .bind(id)
      .first<ReviewRow>()

    return json({ item: updated ? reviewView(updated) : null })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const row = await context.env.DB.prepare('SELECT id, author_name FROM reviews WHERE id = ?')
      .bind(id)
      .first<{ id: string; author_name: string }>()
    if (!row) return error('not_found', 'No such review')

    // Deleting is allowed even while projects use it (spec §10): the pointers
    // are cleared explicitly — the FK's ON DELETE SET NULL may not fire if the
    // connection has foreign_keys off, and the UI needs the same guarantee.
    const usedBy = await projectsUsingReview(context.env, id)
    if (usedBy.length > 0) {
      await context.env.DB.prepare('UPDATE projects SET review_id = NULL WHERE review_id = ?')
        .bind(id)
        .run()
    }

    await context.env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'delete',
      'review',
      id,
      `Deleted the review from '${row.author_name}'${usedBy.length > 0 ? ` (cleared ${usedBy.length} project${usedBy.length === 1 ? '' : 's'})` : ''}`,
    )

    return json({ ok: true, clearedProjects: usedBy.length })
  })
