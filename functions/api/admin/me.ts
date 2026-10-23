import { hasRole, json, type Env, type PagesFunction } from '@marino/api-kit'
import { currentUser } from './_lib/db'
import { run } from './_lib/http'

/*
 * GET /api/admin/me — who the API thinks you are, and what you may do.
 *
 * The SPA uses this on boot. A 401/403 here means Access let the request
 * through but the email has no active `users` row (or is deactivated).
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)

    return json({
      user,
      capabilities: {
        publish: hasRole(user, 'editor'),
        editContent: hasRole(user, 'editor'),
        upload: hasRole(user, 'editor'),
        deleteContent: hasRole(user, 'admin'),
        manageForms: hasRole(user, 'admin'),
        manageSettings: hasRole(user, 'admin'),
        manageUsers: hasRole(user, 'admin'),
        exportSubmissions: hasRole(user, 'admin'),
        viewAudit: hasRole(user, 'admin'),
      },
      siteOrigin: context.env.SITE_ORIGIN,
    })
  })
