import { hasRole, json, type Env, type PagesFunction } from '@marino/api-kit'
import { sessionUserFrom } from './_lib/session'

/*
 * GET /api/auth/me — session identity for the SPA. Returns the same payload
 * shape as /api/admin/me when a valid session exists, or 401 otherwise.
 */

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const found = await sessionUserFrom(context.request, context.env)
  if (!found) return json({ error: { code: 'unauthorized', message: 'Not signed in' } }, { status: 401 })

  return json({
    user: found.user,
    capabilities: {
      publish: hasRole(found.user, 'editor'),
      editContent: hasRole(found.user, 'editor'),
      upload: hasRole(found.user, 'editor'),
      deleteContent: hasRole(found.user, 'admin'),
      manageForms: hasRole(found.user, 'admin'),
      manageSettings: hasRole(found.user, 'admin'),
      manageUsers: hasRole(found.user, 'admin'),
      exportSubmissions: hasRole(found.user, 'admin'),
      viewAudit: hasRole(found.user, 'admin'),
    },
    siteOrigin: context.env.SITE_ORIGIN,
    passwordChanged: found.passwordChanged,
  })
}
