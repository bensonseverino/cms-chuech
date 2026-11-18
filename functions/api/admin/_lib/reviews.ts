import { error, type Env } from '@marino/api-kit'

/*
 * Review validation and view mapping (forms-reviews spec §9).
 *
 * Quotes are stored WITHOUT the surrounding quote marks — the frontend adds
 * those when rendering. `source_url` must be https. Rating is 1–5 or null.
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
  is_visible: number
  position: number
  created_at: string
  updated_at: string
  used_count: number
}

export type ReviewView = {
  id: string
  quote: string
  authorName: string
  authorRole: string | null
  company: string | null
  avatar: string | null
  rating: number | null
  source: string | null
  sourceUrl: string | null
  reviewedAt: string | null
  isFeatured: boolean
  isVisible: boolean
  position: number
  createdAt: string
  updatedAt: string
  usedCount: number
}

export const REVIEW_SELECT = `
  SELECT r.id, r.quote, r.author_name, r.author_role, r.company, r.avatar,
         r.rating, r.source, r.source_url, r.reviewed_at, r.is_featured,
         r.is_visible, r.position, r.created_at, r.updated_at,
         (SELECT COUNT(*) FROM projects p WHERE p.review_id = r.id) AS used_count
    FROM reviews r
`

export function reviewView(row: ReviewRow): ReviewView {
  return {
    id: row.id,
    quote: row.quote,
    authorName: row.author_name,
    authorRole: row.author_role,
    company: row.company,
    avatar: row.avatar,
    rating: row.rating,
    source: row.source,
    sourceUrl: row.source_url,
    reviewedAt: row.reviewed_at,
    isFeatured: row.is_featured === 1,
    isVisible: row.is_visible === 1,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usedCount: row.used_count,
  }
}

export type ReviewInput = {
  quote: string
  authorName: string
  authorRole: string | null
  company: string | null
  avatar: string | null
  rating: number | null
  source: string | null
  sourceUrl: string | null
  reviewedAt: string | null
}

type ParseResult =
  | { ok: true; input: ReviewInput }
  | { ok: false; response: Response }

/**
 * Validate the editable fields (spec §9). Unknown/extra keys are ignored so
 * the editor can round-trip whole view objects.
 */
export function parseReviewInput(value: unknown): ParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, response: error('bad_request', 'Expected a JSON object') }
  }
  const input = value as Record<string, unknown>

  const quote = typeof input.quote === 'string' ? input.quote.trim() : ''
  if (quote.length < 1) return { ok: false, response: error('bad_request', 'A review needs a quote') }
  if (quote.length > 800) {
    return { ok: false, response: error('bad_request', 'The quote is limited to 800 characters') }
  }

  const authorName = typeof input.authorName === 'string' ? input.authorName.trim() : ''
  if (authorName.length < 1) {
    return { ok: false, response: error('bad_request', 'A review needs an author name') }
  }
  if (authorName.length > 100) {
    return { ok: false, response: error('bad_request', 'The author name is limited to 100 characters') }
  }

  const role = optional(input.authorRole, 100)
  if (role.error) return { ok: false, response: role.error }
  const company = optional(input.company, 100)
  if (company.error) return { ok: false, response: company.error }
  const source = optional(input.source, 100)
  if (source.error) return { ok: false, response: source.error }
  const avatar = optional(input.avatar, 500)
  if (avatar.error) return { ok: false, response: avatar.error }

  // `source_url` must be https (spec §9) — the public site links straight to it.
  let sourceUrl: string | null = null
  if (input.sourceUrl !== undefined && input.sourceUrl !== null && input.sourceUrl !== '') {
    if (typeof input.sourceUrl !== 'string') {
      return { ok: false, response: error('bad_request', '`sourceUrl` must be a string') }
    }
    const trimmed = input.sourceUrl.trim()
    if (trimmed.length > 500) {
      return { ok: false, response: error('bad_request', 'The source URL is limited to 500 characters') }
    }
    if (!/^https:\/\//.test(trimmed)) {
      return { ok: false, response: error('bad_request', 'The source URL must start with https://') }
    }
    sourceUrl = trimmed
  }

  let rating: number | null = null
  if (input.rating !== undefined && input.rating !== null) {
    if (typeof input.rating !== 'number' || !Number.isFinite(input.rating)) {
      return { ok: false, response: error('bad_request', '`rating` must be a number') }
    }
    const rounded = Math.round(input.rating)
    if (rounded < 1 || rounded > 5) {
      return { ok: false, response: error('bad_request', 'The rating must be between 1 and 5') }
    }
    rating = rounded
  }

  let reviewedAt: string | null = null
  if (input.reviewedAt !== undefined && input.reviewedAt !== null && input.reviewedAt !== '') {
    if (typeof input.reviewedAt !== 'string' || input.reviewedAt.length > 40) {
      return { ok: false, response: error('bad_request', '`reviewedAt` must be a date string') }
    }
    reviewedAt = input.reviewedAt.trim()
  }

  return {
    ok: true,
    input: {
      quote,
      authorName,
      authorRole: role.value,
      company: company.value,
      avatar: avatar.value,
      rating,
      source: source.value,
      sourceUrl,
      reviewedAt,
    },
  }
}

function optional(
  value: unknown,
  max: number,
): { value: string | null; error?: undefined } | { value?: undefined; error: Response } {
  if (value === undefined || value === null || value === '') return { value: null }
  if (typeof value !== 'string') return { error: error('bad_request', 'Expected a string') }
  const trimmed = value.trim()
  if (trimmed.length > max) {
    return { error: error('bad_request', `Limited to ${max} characters`) }
  }
  return { value: trimmed }
}

/** The projects pointing at a review — for the delete warning (spec §10). */
export async function projectsUsingReview(
  env: Env,
  id: string,
): Promise<Array<{ id: string; title: string }>> {
  const { results } = await env.DB.prepare(
    'SELECT id, title FROM projects WHERE review_id = ? LIMIT 50',
  )
    .bind(id)
    .all<{ id: string; title: string }>()
  return results ?? []
}

/**
 * A project save may link a review, but only one that exists. Returns the 422
 * to send back, or null when the pointer is fine (including `null`).
 */
export async function reviewIdError(
  env: Env,
  reviewId: string | null | undefined,
): Promise<Response | null> {
  if (!reviewId) return null
  const row = await env.DB.prepare('SELECT id FROM reviews WHERE id = ?')
    .bind(reviewId)
    .first<{ id: string }>()
  if (!row) {
    return error('unprocessable', 'Some fields need attention', {
      fields: [{ path: 'reviewId', message: 'Choose an existing review' }],
    })
  }
  return null
}
