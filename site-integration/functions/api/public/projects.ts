import { dataResponse, error, contentVersion, withEdgeCache } from '../_lib/types'
import { listPublishedCards } from '../_lib/projects'
import type { Env, PagesContext } from '../_lib/types'

/*
 * GET /api/public/projects — published case-study cards (cms-projects-spec.md
 * §5.1). Query: `category` (slug), `featured=1`, `limit` (default 12, max 50),
 * `cursor` (opaque offset from the previous page). Ordered by position, then
 * published_at desc.
 *
 * The cursor is the integer offset the previous response handed out; anything
 * that is not a non-negative integer restarts at page one rather than erroring,
 * so a stale or hand-edited link can never break the grid.
 */

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 50

export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const version = await contentVersion(context.env)
  return withEdgeCache(context.request, context, version, async () => {
    const url = new URL(context.request.url)

    const category = url.searchParams.get('category')?.trim() || undefined
    const featured = url.searchParams.get('featured') === '1'
    const rawLimit = Number(url.searchParams.get('limit'))
    const limit =
      Number.isInteger(rawLimit) && rawLimit >= 1
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT
    const rawCursor = Number(url.searchParams.get('cursor'))
    const offset =
      Number.isInteger(rawCursor) && rawCursor >= 0 ? Math.min(rawCursor, 10_000) : 0

    if (category && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category)) {
      return error('bad_request', 'Unknown category slug')
    }

    const { cards, nextCursor } = await listPublishedCards(context.env, {
      category,
      featured,
      limit,
      offset,
    })

    return dataResponse({ projects: cards, ...(nextCursor !== null ? { nextCursor } : {}) }, version)
  })
}
