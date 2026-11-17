import { dataResponse, error, contentVersion, withEdgeCache } from '../../_lib/types'
import { listEntries } from '../../_lib/content'
import { resolveMedia } from '../../_lib/media'
import { listVisibleReviews } from '../../_lib/reviews'
import type { Env, PagesContext } from '../../_lib/types'

const COLLECTIONS = new Set(['services', 'projects', 'testimonials', 'clients', 'articles'])

/*
 * GET /api/public/collections/:name — one published collection, ordered.
 * The Work grid filters client-side; the CMS has no per-collection backends.
 */
export const onRequestGet = async (
  context: PagesContext<Env> & { params: { name: string } },
): Promise<Response> => {
  const raw = context.params.name
  const name = typeof raw === 'string' ? raw : ''
  if (!COLLECTIONS.has(name)) {
    return error('not_found', `Unknown collection '${name}'`)
  }

  const version = await contentVersion(context.env)
  return withEdgeCache(context.request, context, version, async () => {
    // DEPRECATED (cms-forms-reviews-spec.md §9): testimonials moved to the
    // `reviews` table. Serve the alias from reviews so existing consumers keep
    // working — new code uses GET /api/public/reviews instead.
    if (name === 'testimonials') {
      const { reviews } = await listVisibleReviews(context.env, { limit: 50, offset: 0 })
      return dataResponse(
        reviews.map((row) => ({
          id: row.id,
          quote: row.quote,
          author: row.author_name,
          ...(row.company ? { company: row.company } : {}),
        })),
        version,
      )
    }

    // Articles are served newest-first (their `date` field, newest at the top);
    // everything else follows the editorial `sort` order.
    const orderNewest = name === 'articles'
    const items = orderNewest
      ? await listEntriesSortedByDate<Record<string, unknown>>(context.env, name)
      : await listEntries<Record<string, unknown>>(context.env, name)
    const resolved = await resolveMedia(items, context.env)
    return dataResponse(resolved, version)
  })
}

/**
 * Articles sort by their `date` field, newest first (spec §2.1: date is "used
 * for ordering"). `listEntries` sorts by `sort`, so re-sort here.
 */
async function listEntriesSortedByDate<T extends { date?: string }>(
  env: Env,
  collection: string,
): Promise<T[]> {
  const items = await listEntries<T>(env, collection)
  return [...items].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}
