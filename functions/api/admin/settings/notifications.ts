import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run } from '../_lib/http'
import { normaliseEmails } from '../_lib/forms'

/*
 * GET /api/admin/settings/notifications — `{ enabled, emails, provider }` for
 * the Settings card (forms-reviews spec §5). `provider` is read-only: it tells
 * the UI whether Resend and Turnstile are configured, nothing more.
 * PUT — saves `{ enabled, emails }` into site_settings.
 */

const KEY = 'notifications'

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    let enabled = true
    let emails: string[] = []

    const row = await context.env.DB.prepare('SELECT value FROM site_settings WHERE key = ?')
      .bind(KEY)
      .first<{ value: string }>()
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as { enabled?: unknown; emails?: unknown }
        if (typeof parsed.enabled === 'boolean') enabled = parsed.enabled
        if (Array.isArray(parsed.emails)) {
          emails = parsed.emails.filter((item): item is string => typeof item === 'string')
        }
      } catch {
        // A hand-edited row falls back to the defaults above.
      }
    }

    return json({
      enabled,
      emails,
      provider: {
        email: Boolean(context.env.RESEND_API_KEY && context.env.NOTIFY_FROM),
        turnstile: Boolean(context.env.TURNSTILE_SECRET || context.env.TURNSTILE_BYPASS),
      },
    })
  })

export const onRequestPut: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    let enabled = true
    if (body.value.enabled !== undefined) {
      if (typeof body.value.enabled !== 'boolean') {
        return error('bad_request', '`enabled` must be a boolean')
      }
      enabled = body.value.enabled
    }

    let emails: string[] = []
    if (body.value.emails !== undefined) {
      const normalised = normaliseEmails(body.value.emails)
      if (!normalised.ok) return normalised.response
      emails = normalised.emails
    }

    await context.env.DB.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(KEY, JSON.stringify({ enabled, emails }))
      .run()

    await audit(
      context.env,
      actorOf(user),
      'update',
      'settings',
      KEY,
      `Notification settings ${enabled ? 'enabled' : 'disabled'}; ${emails.length} recipient${emails.length === 1 ? '' : 's'}`,
    )

    return json({ enabled, emails })
  })
