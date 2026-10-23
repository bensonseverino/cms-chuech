import type { Env, PagesContext } from '../api/_lib/types'

/*
 * GET /media/<r2 key> — the same-origin reader for the shared media bucket.
 *
 * The public API stores media as references and resolves them to
 * `${MEDIA_PUBLIC_BASE}/<r2_key>` (see functions/api/_lib/media.ts). With
 * MEDIA_PUBLIC_BASE left at its default of `/media`, every CMS image and video
 * is served through this route, so the site works locally and in production
 * without a separate R2 custom domain. Point MEDIA_PUBLIC_BASE at that domain
 * instead if one is configured; this route then simply goes unused.
 *
 * R2 object keys are immutable, so the response is cached for a year.
 */
export const onRequestGet = async (
  context: PagesContext<Env> & { params: { path?: string | string[] } },
): Promise<Response> => {
  const parts = context.params.path
  const key = Array.isArray(parts) ? parts.join('/') : (parts ?? '')
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 })

  const object = await context.env.MEDIA.get(key)
  if (!object) return new Response('Not found', { status: 404 })

  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  if (object.httpEtag) headers.set('ETag', object.httpEtag)

  return new Response(object.body, { headers })
}
