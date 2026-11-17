import { dataResponse, error, contentVersion, withEdgeCache } from '../../_lib/types'
import { findDetail, slugRedirect } from '../../_lib/projects'
import { verifyPreviewToken } from '../../_lib/preview'
import type { Env, PagesContext } from '../../_lib/types'

/*
 * GET /api/public/projects/:slug — one case study's full detail, with `related`
 * already resolved to cards (cms-projects-spec.md §5.1, §5.2).
 *
 * - Unknown or draft slug → 404 (the site renders its own 404 page).
 * - A renamed slug still in `project_slug_history` → 200 `{ redirectTo }` and
 *   the client navigates (replace) to the new URL.
 * - `?preview=<token>` also returns drafts: the token is signed with
 *   PREVIEW_SECRET, short lived, slug-bound and only honoured here. A preview
 *   response is `Cache-Control: no-store` and never edge-cached.
 */

export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const { request, env, params } = context
  const slug = typeof params.slug === 'string' ? params.slug : ''

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return error('not_found', 'No such project')
  }

  const url = new URL(request.url)
  const previewToken = url.searchParams.get('preview')
  const preview = previewToken ? await verifyPreviewToken(env, previewToken) : null
  const isPreview = preview !== null && preview.slug === slug

  // A preview response must never be cached anywhere: build it directly.
  if (isPreview) {
    const detail = await findDetail(env, slug, true)
    if (!detail) return error('not_found', 'No such project')
    return dataResponse(detail, await contentVersion(env), {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const version = await contentVersion(env)
  return withEdgeCache(request, context, version, async () => {
    const detail = await findDetail(env, slug, false)
    if (detail) return dataResponse(detail, version)

    const redirectTo = await slugRedirect(env, slug)
    if (redirectTo) return dataResponse({ redirectTo }, version)

    return error('not_found', 'No such project')
  })
}
