import { dataResponse, error, contentVersion, withEdgeCache } from '../_lib/types'
import { getDocument, listEntries } from '../_lib/content'
import { resolveMedia } from '../_lib/media'
import type { Env, PagesContext } from '../_lib/types'

/*
 * GET /api/public/services-page — the `_services` index document plus the
 * services rows the page reuses (with the inline link variant applied
 * client-side). Same contract as /home: one fetch renders the page.
 */
export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const version = await contentVersion(context.env)
  return withEdgeCache(context.request, context, version, async () => {
    const [index, services, projects, clients, testimonials, home] = await Promise.all([
      getDocument<Record<string, unknown>>(context.env, '_services'),
      listEntries<Record<string, unknown>>(context.env, 'services'),
      listEntries<Record<string, unknown>>(context.env, 'projects', { limit: 50 }),
      listEntries<Record<string, unknown>>(context.env, 'clients'),
      listEntries<Record<string, unknown>>(context.env, 'testimonials'),
      // The shared Experience band on /services renders `_home.stats`.
      getDocument<Record<string, unknown>>(context.env, '_home'),
    ])

    if (!index.data) {
      return error('not_found', 'No published services page yet')
    }

    const data = {
      index: index.data,
      services,
      projects,
      clients,
      testimonials,
      home: home.data,
    }
    const resolved = await resolveMedia(data, context.env)
    return dataResponse(resolved, version)
  })
}
