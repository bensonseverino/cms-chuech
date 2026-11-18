import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { run } from '../_lib/http'

/*
 * POST /api/admin/settings/test-email — send a test notification from the
 * Settings card (forms-reviews spec §5). Uses the same recipients resolution
 * as the live pipeline (form lists aside): the saved `notifications` emails,
 * else NOTIFY_DEFAULT_TO. A failure returns the provider's message so the
 * card can show it inline.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    if (!context.env.RESEND_API_KEY || !context.env.NOTIFY_FROM) {
      return error('bad_request', 'The email provider is not configured (RESEND_API_KEY / NOTIFY_FROM)')
    }

    let emails: string[] = []
    const row = await context.env.DB.prepare(
      "SELECT value FROM site_settings WHERE key = 'notifications'",
    )
      .first<{ value: string }>()
      .catch(() => null)
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as { emails?: unknown }
        if (Array.isArray(parsed.emails)) {
          emails = parsed.emails.filter(
            (item): item is string => typeof item === 'string' && EMAIL_RE.test(item),
          )
        }
      } catch {
        emails = []
      }
    }
    if (emails.length === 0 && context.env.NOTIFY_DEFAULT_TO && EMAIL_RE.test(context.env.NOTIFY_DEFAULT_TO)) {
      emails = [context.env.NOTIFY_DEFAULT_TO]
    }
    if (emails.length === 0) {
      return error('bad_request', 'Add at least one recipient email first')
    }

    const to = emails[0]
    let result: { ok: boolean; error?: string }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: context.env.NOTIFY_FROM,
          to: [to],
          subject: 'Chuech CMS — test notification',
          html: `<div style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;max-width:560px">
            <h2 style="color:#231f20;font-size:18px;margin:0 0 4px">Test notification</h2>
            <p style="color:#666;font-size:13px;margin:0 0 12px">
              Form notifications are configured correctly. Emails like this will
              arrive when someone submits a form on the site.
            </p>
          </div>`,
          text: 'Chuech CMS test notification — form emails are configured correctly.',
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        result = { ok: true }
      } else {
        const detail = (await response.text()).slice(0, 300)
        result = { ok: false, error: `Resend responded ${response.status}: ${detail}` }
      }
    } catch (cause) {
      result = { ok: false, error: cause instanceof Error ? cause.message : 'send failed' }
    }

    await audit(
      context.env,
      actorOf(user),
      'test',
      'settings',
      'notifications',
      result.ok ? `Sent a test email to ${to}` : `Test email failed: ${result.error ?? 'unknown error'}`,
    )

    if (!result.ok) {
      return error('server_error', result.error ?? 'The test email could not be sent')
    }

    return json({ ok: true, to })
  })
