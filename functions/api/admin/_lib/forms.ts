import { error, type Env } from '@marino/api-kit'

/*
 * Form settings helpers shared by the list and one-source endpoints.
 */

export type FormRow = {
  source: string
  label: string
  enabled: number
  notify_emails: string
  success_message: string
  auto_registered: number
  created_at: string
  total_count: number
  new_count: number
  last_submission_at: string | null
}

export type FormView = {
  source: string
  label: string
  enabled: boolean
  notifyEmails: string[]
  successMessage: string
  autoRegistered: boolean
  createdAt: string
  totalCount: number
  newCount: number
  lastSubmissionAt: string | null
}

export const FORM_SELECT = `
  SELECT f.source, f.label, f.enabled, f.notify_emails, f.success_message,
         f.auto_registered, f.created_at,
         (SELECT COUNT(*) FROM submissions s WHERE s.source = f.source) AS total_count,
         (SELECT COUNT(*) FROM submissions s WHERE s.source = f.source AND s.status = 'new') AS new_count,
         (SELECT MAX(s.created_at) FROM submissions s WHERE s.source = f.source) AS last_submission_at
    FROM forms f
`

export function formView(row: FormRow): FormView {
  return {
    source: row.source,
    label: row.label,
    enabled: row.enabled === 1,
    notifyEmails: parseEmails(row.notify_emails),
    successMessage: row.success_message,
    autoRegistered: row.auto_registered === 1,
    createdAt: row.created_at,
    totalCount: row.total_count,
    newCount: row.new_count,
    lastSubmissionAt: row.last_submission_at,
  }
}

export function parseEmails(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // A hand-edited row may contain a comma list. Treat it as such.
  }
  return value
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EmailResult = { ok: true; emails: string[] } | { ok: false; response: Response }

export function normaliseEmails(value: unknown): EmailResult {
  let list: string[] = []

  if (typeof value === 'string') {
    list = value.split(',').map((email) => email.trim()).filter(Boolean)
  } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    list = (value as string[]).map((email) => email.trim()).filter(Boolean)
  } else {
    return { ok: false, response: error('bad_request', 'notifyEmails must be an array or comma list') }
  }

  if (list.length > 10) {
    return { ok: false, response: error('bad_request', 'At most 10 notification addresses') }
  }

  for (const email of list) {
    if (email.length > 320 || !EMAIL.test(email)) {
      return { ok: false, response: error('bad_request', `'${email}' is not a valid email address`) }
    }
  }

  return { ok: true, emails: [...new Set(list.map((email) => email.toLowerCase()))] }
}

export async function loadForm(env: Env, source: string): Promise<FormRow | null> {
  return env.DB.prepare(`${FORM_SELECT} WHERE f.source = ?`)
    .bind(source)
    .first<FormRow>()
}
