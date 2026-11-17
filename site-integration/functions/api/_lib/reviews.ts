import type { Env } from './types'

/*
 * Public review reads (cms-forms-reviews-spec.md §9).
 *
 * Every visitor-facing quote comes from the `reviews` table, managed in the
 * admin CMS. The frontend renders its own quote marks around `quote` — the
 * stored value never includes them.
 */

export type ReviewRow = {
  id: string
  quote: string
  author_name: string
  author_role: string | null
  company: string | null
  avatar: string | null
  rating: number | null
  source: string | null
  source_url: string | null
  reviewed_at: string | null
  is_featured: number
  position: number
}

/** The public JSON shape for one review (spec §9). */
export type ReviewView = {
  id: string
  quote: string
  author: string
  role?: string
  company?: string
  avatar?: string
  rating?: number
  source?: string
  sourceUrl?: string
  reviewedAt?: string
  featured: boolean
  position: number
}

export function toReviewView(row: ReviewRow): ReviewView {
  return {
    id: row.id,
    quote: row.quote,
    author: row.author_name,
    ...(row.author_role ? { role: row.author_role } : {}),
    ...(row.company ? { company: row.company } : {}),
    ...(row.avatar ? { avatar: row.avatar } : {}),
    ...(row.rating ? { rating: row.rating } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    featured: row.is_featured === 1,
    position: row.position,
  }
}

export type ReviewListOptions = {
  featured?: boolean
  limit: number
  offset: number
}

/** Visible reviews, editorial order (spec §9): position, then created_at. */
export async function listVisibleReviews(
  env: Env,
  options: ReviewListOptions,
): Promise<{ reviews: ReviewRow[]; total: number }> {
  const where = options.featured ? 'WHERE is_visible = 1 AND is_featured = 1' : 'WHERE is_visible = 1'

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM reviews ${where}`).first<{ count: number }>()
  const total = countRow?.count ?? 0

  const { results } = await env.DB.prepare(
    `SELECT id, quote, author_name, author_role, company, avatar, rating,
            source, source_url, reviewed_at, is_featured, position
       FROM reviews ${where}
      ORDER BY position ASC, created_at ASC, id ASC
      LIMIT ? OFFSET ?`,
  )
    .bind(options.limit, options.offset)
    .all<ReviewRow>()

  return { reviews: results ?? [], total }
}
