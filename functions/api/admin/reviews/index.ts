import {
  audit,
  bumpContentVersion,
  error,
  json,
  newId,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run } from '../_lib/http'
import { parseReviewInput, REVIEW_SELECT, reviewView, type ReviewRow } from '../_lib/reviews'

/*
 * GET  /api/admin/reviews — every review in site order, with usage counts
 * POST /api/admin/reviews — create (appends to the end of the order)
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const { results } = await context.env.DB.prepare(
      `${REVIEW_SELECT} ORDER BY r.position ASC, r.id ASC`,
    ).all<ReviewRow>()

    return json({ items: (results ?? []).map(reviewView) })
  })

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const parsed = parseReviewInput(body.value)
    if (!parsed.ok) return parsed.response
    const input = parsed.input

    const maxRow = await context.env.DB.prepare(
      'SELECT COALESCE(MAX(position), 0) AS max_position FROM reviews',
    ).first<{ max_position: number }>()
    const position = (maxRow?.max_position ?? 0) + 10

    const id = newId()
    await context.env.DB.prepare(
      `INSERT INTO reviews
         (id, quote, author_name, author_role, company, avatar, rating, source,
          source_url, reviewed_at, is_featured, is_visible, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        input.quote,
        input.authorName,
        input.authorRole,
        input.company,
        input.avatar,
        input.rating,
        input.source,
        input.sourceUrl,
        input.reviewedAt,
        body.value.isFeatured === true ? 1 : 0,
        position,
      )
      .run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'create',
      'review',
      id,
      `Added a review from '${input.authorName}'`,
    )

    const row = await context.env.DB.prepare(`${REVIEW_SELECT} WHERE r.id = ?`)
      .bind(id)
      .first<ReviewRow>()

    return json({ item: row ? reviewView(row) : null }, { status: 201 })
  })
