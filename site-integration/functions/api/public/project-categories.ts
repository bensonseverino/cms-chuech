import { dataResponse, contentVersion, withEdgeCache } from '../_lib/types'
import { listCategories } from '../_lib/projects'
import type { Env, PagesContext } from '../_lib/types'

/*
 * GET /api/public/project-categories — the categories in editorial order
 * (cms-projects-spec.md §5.1). Drives any category filtering on the Work page
 * without the design having to hardcode the list.
 */

export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const version = await contentVersion(context.env)
  return withEdgeCache(context.request, context, version, async () => {
    const categories = await listCategories(context.env)
    return dataResponse(
      { categories: categories.map(({ slug, label }) => ({ slug, label })) },
      version,
    )
  })
}
