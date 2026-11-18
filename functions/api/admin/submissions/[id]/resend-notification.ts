import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../../_lib/db'
import { run } from '../../_lib/http'
import { loadSubmission, submissionView } from '../../_lib/submissions'

/*
 * POST /api/admin/submissions/:id/resend-notification
 *
 * Retries the owner email for a submission (forms-reviews spec §6). Rebuilds
 * the message from what is stored — the form definition for labels, the
 * submission's `fields` for values — so a resend matches what the first send
 * would have been. `notify_status`/`notify_error` are updated with the result;
 * a missing provider config is `skipped`, not `failed`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FieldDef = { id?: unknown; label?: unknown }

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = context.params.id
    if (!id) return error('bad_request', 'Missing submission id')

    const row = await loadSubmission(context.env, id)
    if (!row) return error('not_found', 'No such submission')

    const form = await context.env.DB.prepare(
      'SELECT source, label, notify_emails, fields FROM forms WHERE source = ?',
    )
      .bind(row.source)
      .first<{ source: string; label: string; notify_emails: string; fields: string | null }>()

    const mark = (status: string, notifyError?: string) =>
      context.env.DB.prepare(
        'UPDATE submissions SET notify_status = ?, notify_error = ? WHERE id = ?',
      )
        .bind(status, notifyError ? notifyError.slice(0, 300) : null, id)
        .run()

    // Missing provider config is 'skipped' (§5), not 'failed': nothing was sent.
    if (!context.env.RESEND_API_KEY || !context.env.NOTIFY_FROM) {
      await mark('skipped', 'Email provider not configured')
      return error('bad_request', 'The email provider is not configured (RESEND_API_KEY / NOTIFY_FROM)')
    }

    // Recipients resolve exactly like the public pipeline: the form's list,
    // else the global `site_settings.notifications`, else NOTIFY_DEFAULT_TO.
    const recipients = await recipientsFor(context.env, form?.notify_emails ?? '[]')
    if (recipients.length === 0) {
      await mark('skipped', 'No recipients configured')
      return error('bad_request', 'No notification recipients configured')
    }

    const values = parseValues(row.fields)
    const defs = parseDefs(form?.fields ?? null)
    const formLabel = form?.label ?? row.source
    const { html, text } = buildEmail(context.env, formLabel, values, defs, id, row)

    const replyTo = row.email && EMAIL_RE.test(row.email) ? row.email : undefined

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
          to: recipients,
          subject: `New "${formLabel}" submission`,
          html,
          text,
          ...(replyTo ? { reply_to: replyTo } : {}),
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

    await mark(result.ok ? 'sent' : 'failed', result.ok ? undefined : result.error)

    await audit(
      context.env,
      actorOf(user),
      'resend',
      'submission',
      id,
      result.ok
        ? `Resent the notification to ${recipients.join(', ')}`
        : `Notification resend failed: ${result.error ?? 'unknown error'}`,
    )

    if (!result.ok) {
      return error('server_error', result.error ?? 'The email could not be sent')
    }

    const updated = await loadSubmission(context.env, id)
    return json({ ok: true, item: updated ? submissionView(updated) : null })
  })

async function recipientsFor(env: Env, notifyEmails: string): Promise<string[]> {
  let list: string[] = []
  try {
    const parsed = JSON.parse(notifyEmails || '[]') as unknown
    if (Array.isArray(parsed)) {
      list = parsed.filter((item): item is string => typeof item === 'string' && EMAIL_RE.test(item))
    }
  } catch {
    list = []
  }
  if (list.length > 0) return list

  try {
    const settings = await env.DB.prepare(
      "SELECT value FROM site_settings WHERE key = 'notifications'",
    ).first<{ value: string }>()
    if (settings?.value) {
      const parsed = JSON.parse(settings.value) as { emails?: unknown; enabled?: unknown }
      if (parsed.enabled === false) return []
      if (Array.isArray(parsed.emails)) {
        return parsed.emails.filter(
          (item): item is string => typeof item === 'string' && EMAIL_RE.test(item),
        )
      }
    }
  } catch {
    // No settings row yet — fall through.
  }
  return env.NOTIFY_DEFAULT_TO && EMAIL_RE.test(env.NOTIFY_DEFAULT_TO)
    ? [env.NOTIFY_DEFAULT_TO]
    : []
}

function parseValues(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Empty values are fine; the email will just show context.
  }
  return {}
}

function parseDefs(raw: string | null): FieldDef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as FieldDef[]) : []
  } catch {
    return []
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildEmail(
  env: Env,
  formLabel: string,
  values: Record<string, unknown>,
  defs: FieldDef[],
  id: string,
  row: { page_path: string | null; created_at: string },
): { html: string; text: string } {
  const labelOf = (key: string) => {
    const def = defs.find((item) => item.id === key)
    return typeof def?.label === 'string' && def.label ? def.label.replace(/\*$/, '') : key
  }

  const entries = Object.entries(values).filter(
    ([key, value]) =>
      !key.startsWith('_') && value !== '' && value !== false && value !== null && value !== undefined,
  )

  const rows = entries
    .map(([key, value]) => {
      const shown = Array.isArray(value)
        ? escapeHtml(value.map((item) => String(item)).join(', '))
        : typeof value === 'boolean'
          ? 'Yes'
          : escapeHtml(String(value))
      return `<tr>
        <td style="padding:6px 12px;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(labelOf(key))}</td>
        <td style="padding:6px 12px;color:#231f20"><strong>${shown}</strong></td>
      </tr>`
    })
    .join('')

  const pageRow = row.page_path
    ? `<tr>
        <td style="padding:6px 12px;color:#666;vertical-align:top;white-space:nowrap">Page</td>
        <td style="padding:6px 12px;color:#231f20">${escapeHtml(row.page_path)}</td>
      </tr>`
    : ''

  const link = env.ADMIN_URL ? `${env.ADMIN_URL.replace(/\/+$/, '')}/inbox/${id}` : ''
  const linkHtml = link
    ? `<p style="margin:20px 0 4px"><a href="${escapeHtml(link)}" style="background:#82ffcd;color:#231f20;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700;font-size:13px">Open in the CMS</a></p>`
    : ''

  const html = `<div style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;max-width:560px">
    <h2 style="color:#231f20;font-size:18px;margin:0 0 4px">New &ldquo;${escapeHtml(formLabel)}&rdquo; submission</h2>
    <p style="color:#666;font-size:13px;margin:0 0 16px">Received ${escapeHtml(row.created_at)} (UTC)</p>
    <table style="border-collapse:collapse;font-size:14px;width:100%">${rows}${pageRow}</table>
    ${linkHtml}
  </div>`

  const textLines = entries.map(
    ([key, value]) =>
      `${labelOf(key)}: ${Array.isArray(value) ? value.map((item) => String(item)).join(', ') : String(value)}`,
  )
  if (row.page_path) textLines.push(`Page: ${row.page_path}`)
  const text = `New "${formLabel}" submission (${row.created_at} UTC)\n\n${textLines.join('\n')}${link ? `\n\n${link}` : ''}`

  return { html, text }
}
