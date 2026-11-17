import { dataResponse, error, contentVersion, withEdgeCache } from '../_lib/types'
import { getDocument, listEntries } from '../_lib/content'
import { resolveMedia } from '../_lib/media'
import { listVisibleReviews } from '../_lib/reviews'
import type { Env, PagesContext } from '../_lib/types'

/*
 * GET /api/public/home — the `_home` document plus the collections the Home
 * panel reads in one round trip: featured projects, the services list
 * (showOnHome), reviews, clients and the 4 insight articles.
 */
export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const version = await contentVersion(context.env)
  return withEdgeCache(context.request, context, version, async () => {
    const [home, services, projects, reviews, clients, articles] = await Promise.all([
      getDocument<Record<string, unknown>>(context.env, '_home'),
      listEntries<Record<string, unknown>>(context.env, 'services'),
      listEntries<Record<string, unknown>>(context.env, 'projects', { limit: 50 }),
      listVisibleReviews(context.env, { featured: true, limit: 50, offset: 0 }),
      listEntries<Record<string, unknown>>(context.env, 'clients'),
      listEntries<Record<string, unknown>>(context.env, 'articles', { limit: 4 }),
    ])

    if (!home.data) {
      return error('not_found', 'No published home content yet')
    }

    // The frontend maps `{ quote, author, company }` — serve reviews in that
    // shape under the legacy key (forms-reviews spec §9).
    const testimonials = reviews.reviews.map((row) => ({
      id: row.id,
      quote: row.quote,
      author: row.author_name,
      ...(row.company ? { company: row.company } : {}),
    }))

    const data = {
      home: home.data,
      services,
      projects,
      testimonials,
      clients,
      articles,
    }
    const resolved = await resolveMedia(data, context.env)
    return dataResponse(resolved, version)
  })
}
