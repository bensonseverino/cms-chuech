import { error, type Env } from '@marino/api-kit'

/*
 * Form settings helpers shared by the list and one-source endpoints.
 */

export type AutoresponderRow = {
  enabled?: boolean
  subject?: string
  body?: string
}

export type FormRow = {
  source: string
  label: string
  enabled: number
  notify_emails: string
  success_message: string
  fields: string | null
  autoresponder: string | null
  auto_registered: number
  created_at: string
  total_count: number
  new_count: number
  last_submission_at: string | null
}

export type FormFieldDefView = {
  id: string
  type: string
  label: string
  placeholder?: string
  required?: boolean
  options?: string[]
  validation?: { min?: number; max?: number; pattern?: string; message?: string }
}

export type FormView = {
  source: string
  label: string
  enabled: boolean
  notifyEmails: string[]
  successMessage: string
  fields: FormFieldDefView[]
  autoresponder: AutoresponderRow | null
  autoRegistered: boolean
  createdAt: string
  totalCount: number
  newCount: number
  lastSubmissionAt: string | null
}

export const FORM_SELECT = `
  SELECT f.source, f.label, f.enabled, f.notify_emails, f.success_message,
         f.fields, f.autoresponder, f.auto_registered, f.created_at,
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
    fields: parseFieldDefs(row.fields),
    autoresponder: parseAutoresponder(row.autoresponder),
    autoRegistered: row.auto_registered === 1,
    createdAt: row.created_at,
    totalCount: row.total_count,
    newCount: row.new_count,
    lastSubmissionAt: row.last_submission_at,
  }
}

function parseFieldDefs(raw: string | null): FormFieldDefView[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is FormFieldDefView =>
        typeof item === 'object' && item !== null &&
        typeof (item as FormFieldDefView).id === 'string' &&
        typeof (item as FormFieldDefView).label === 'string' &&
        typeof (item as FormFieldDefView).type === 'string',
    )
  } catch {
    return []
  }
}

function parseAutoresponder(raw: string | null): AutoresponderRow | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as AutoresponderRow
    }
  } catch {
    // A hand-edited row just means "no autoresponder" to the editor.
  }
  return null
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

const FIELD_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/
const FIELD_TYPES = new Set([
  'text',
  'email',
  'tel',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'checkboxes',
  'url',
])

export type FieldDefsResult =
  | { ok: true; json: string; count: number }
  | { ok: false; response: Response }

/**
 * Validate the field builder's output (forms-reviews spec §6): an array of
 * field objects whose `id`s are unique and match `^[a-zA-Z][a-zA-Z0-9_]*$`
 * (they become JSON keys and DOM names), with a known type and a label.
 */
export function validateFieldDefs(value: unknown): FieldDefsResult {
  if (!Array.isArray(value)) {
    return { ok: false, response: error('bad_request', '`fields` must be an array') }
  }
  if (value.length > 50) {
    return { ok: false, response: error('bad_request', 'At most 50 fields per form') }
  }

  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, response: error('bad_request', 'Every field must be an object') }
    }
    const field = item as Record<string, unknown>

    const id = typeof field.id === 'string' ? field.id.trim() : ''
    if (!FIELD_ID_RE.test(id)) {
      return {
        ok: false,
        response: error(
          'bad_request',
          `Field keys must start with a letter and use only letters, numbers and underscores — '${id || '(empty)'}' does not`,
        ),
      }
    }
    if (seen.has(id)) {
      return { ok: false, response: error('conflict', `Two fields share the key '${id}'`) }
    }
    seen.add(id)

    const label = typeof field.label === 'string' ? field.label.trim() : ''
    if (!label || label.length > 120) {
      return { ok: false, response: error('bad_request', `Field '${id}' needs a label of at most 120 characters`) }
    }

    if (typeof field.type !== 'string' || !FIELD_TYPES.has(field.type)) {
      return { ok: false, response: error('bad_request', `Field '${id}' has an unknown type`) }
    }

    if (field.placeholder !== undefined && field.placeholder !== null) {
      if (typeof field.placeholder !== 'string' || field.placeholder.length > 200) {
        return { ok: false, response: error('bad_request', `Field '${id}' placeholder is limited to 200 characters`) }
      }
    }

    if (field.required !== undefined && typeof field.required !== 'boolean') {
      return { ok: false, response: error('bad_request', `Field '${id}' required must be a boolean`) }
    }

    if (field.options !== undefined) {
      if (
        !Array.isArray(field.options) ||
        !field.options.every((option) => typeof option === 'string' && option.length <= 200)
      ) {
        return { ok: false, response: error('bad_request', `Field '${id}' options must be short strings`) }
      }
      if ((field.type === 'select' || field.type === 'radio' || field.type === 'checkboxes') && field.options.length === 0) {
        return { ok: false, response: error('bad_request', `Field '${id}' needs at least one option`) }
      }
    }
  }

  return { ok: true, json: JSON.stringify(value), count: value.length }
}

export type AutoresponderResult =
  | { ok: true; json: string | null }
  | { ok: false; response: Response }

/** The optional autoresponder config (spec §5): on/off, subject, body with `{{name}}`. */
export function validateAutoresponder(value: unknown): AutoresponderResult {
  if (value === null) return { ok: true, json: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, response: error('bad_request', '`autoresponder` must be an object or null') }
  }
  const config = value as Record<string, unknown>

  if (typeof config.enabled !== 'boolean') {
    return { ok: false, response: error('bad_request', '`autoresponder.enabled` must be a boolean') }
  }
  const subject = typeof config.subject === 'string' ? config.subject.trim() : ''
  const body = typeof config.body === 'string' ? config.body : ''
  if (config.enabled && (!subject || subject.length > 200)) {
    return { ok: false, response: error('bad_request', 'The autoresponder needs a subject of at most 200 characters') }
  }
  if (config.enabled && (!body || body.length > 5000)) {
    return { ok: false, response: error('bad_request', 'The autoresponder needs a body of at most 5000 characters') }
  }

  return { ok: true, json: JSON.stringify({ enabled: config.enabled, subject, body }) }
}
