import {
  error,
  json,
  requireRole,
  signPreviewToken,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { currentUser } from './_lib/db'
import { isObject, readJsonBody, run } from './_lib/http'

/* POST /api/admin/preview-token — mint a 30-minute draft preview token */

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value) || typeof body.value.slug !== 'string') {
      return error('bad_request', 'Expected { slug }')
    }

    const slug = body.value.slug.trim()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return error('bad_request', 'Invalid slug')
    }

    const token = await signPreviewToken(context.env, slug)
    if (!token) return error('server_error', 'Could not generate a preview token')

    return json({
      token,
      expiresAt: 30 * 60,
      url: `${context.env.SITE_ORIGIN}/api/public/projects/${encodeURIComponent(slug)}?preview=${encodeURIComponent(token)}`,
    })
  })
