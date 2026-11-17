import { dataResponse, contentVersion, withEdgeCache } from '../_lib/types'
import { listVisibleReviews, toReviewView } from '../_lib/reviews'
import type { Env, PagesContext } from '../_lib/types'

/*
 * GET /api/public/reviews — visitor reviews for the sliders (cms-forms-reviews-
 * spec.md §9). Query: `featured=1`, `limit` (default 12, max 50), `cursor`
 * (opaque offset). Visible rows only, editorial order. The frontend adds the
 * quote marks around `quote` — the stored value never includes them.
 */

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 50

export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const version = await contentVersion(context.env)
  return withEdgeCache(context.request, context, version, async () => {
    const url = new URL(context.request.url)

    const featured = url.searchParams.get('featured') === '1'
    const rawLimit = Number(url.searchParams.get('limit'))
    const limit =
      Number.isInteger(rawLimit) && rawLimit >= 1
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT
    const rawCursor = Number(url.searchParams.get('cursor'))
    const offset =
      Number.isInteger(rawCursor) && rawCursor >= 0 ? Math.min(rawCursor, 10_000) : 0

    const { reviews, total } = await listVisibleReviews(context.env, { featured, limit, offset })
    const nextOffset = offset + reviews.length
    const nextCursor = reviews.length < limit || nextOffset >= total ? null : nextOffset

    return dataResponse(
      { reviews: reviews.map(toReviewView), ...(nextCursor !== null ? { nextCursor } : {}) },
      version,
    )
  })
}
