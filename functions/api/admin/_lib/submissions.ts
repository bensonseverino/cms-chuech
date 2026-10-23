import type { Env } from '@marino/api-kit'
import { isIsoDate } from './http'

/*
 * Submission list/detail helpers. Both the JSON list and the CSV export build
 * their WHERE clause here, so the export can never silently disagree with what
 * the screen is showing.
 */

export const SUBMISSION_STATUSES = ['new', 'read', 'replied', 'spam', 'archived'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export function isSubmissionStatus(value: string): value is SubmissionStatus {
  return (SUBMISSION_STATUSES as readonly string[]).includes(value)
}

export type SubmissionRow = {
  id: string
  source: string
  status: string
  name: string | null
  email: string | null
  phone: string | null
  message: string | null
  fields: string
  page_path: string | null
  referrer: string | null
  utm: string
  user_agent: string | null
  ip_hash: string | null
  turnstile_ok: number
  notes: string
  handled_by: string | null
  handled_by_email: string | null
  created_at: string
  updated_at: string
  form_label: string | null
}

export type SubmissionView = {
  id: string
  source: string
  formLabel: string | null
  status: string
  name: string | null
  email: string | null
  phone: string | null
  message: string | null
  fields: Record<string, unknown>
  pagePath: string | null
  referrer: string | null
  utm: Record<string, unknown>
  userAgent: string | null
  turnstileOk: boolean
  notes: string
  handledBy: string | null
  handledByEmail: string | null
  createdAt: string
  updatedAt: string
}

export const SUBMISSION_SELECT = `
  SELECT s.id, s.source, s.status, s.name, s.email, s.phone, s.message,
         s.fields, s.page_path, s.referrer, s.utm, s.user_agent, s.ip_hash,
         s.turnstile_ok, s.notes, s.handled_by, s.created_at, s.updated_at,
         f.label AS form_label, u.email AS handled_by_email
    FROM submissions s
    LEFT JOIN forms f ON f.source = s.source
    LEFT JOIN users u ON u.id = s.handled_by
`

export type SubmissionFilters = {
  source?: string
  status?: string
  q?: string
  from?: string
  to?: string
}

export type BuiltFilter = { where: string; bindings: unknown[] }

export function buildSubmissionFilter(
  filters: SubmissionFilters,
  includeStatus = true,
): BuiltFilter {
  const conditions: string[] = []
  const bindings: unknown[] = []

  if (filters.source) {
    conditions.push('s.source = ?')
    bindings.push(filters.source)
  }

  if (includeStatus && filters.status) {
    conditions.push('s.status = ?')
    bindings.push(filters.status)
  }

  if (filters.q) {
    conditions.push(
      '(s.name LIKE ? OR s.email LIKE ? OR s.phone LIKE ? OR s.message LIKE ? OR s.fields LIKE ?)',
    )
    const like = `%${filters.q}%`
    bindings.push(like, like, like, like, like)
  }

  if (filters.from && isIsoDate(filters.from)) {
    conditions.push('date(s.created_at) >= date(?)')
    bindings.push(filters.from)
  }

  if (filters.to && isIsoDate(filters.to)) {
    conditions.push('date(s.created_at) <= date(?)')
    bindings.push(filters.to)
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    bindings,
  }
}

export function submissionView(row: SubmissionRow): SubmissionView {
  return {
    id: row.id,
    source: row.source,
    formLabel: row.form_label,
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    fields: parseObject(row.fields),
    pagePath: row.page_path,
    referrer: row.referrer,
    utm: parseObject(row.utm),
    userAgent: row.user_agent,
    turnstileOk: row.turnstile_ok === 1,
    notes: row.notes,
    handledBy: row.handled_by,
    handledByEmail: row.handled_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export async function loadSubmission(env: Env, id: string): Promise<SubmissionRow | null> {
  return env.DB.prepare(`${SUBMISSION_SELECT} WHERE s.id = ?`).bind(id).first<SubmissionRow>()
}

/** Previous/next within the whole inbox, newest first. */
export async function neighbours(
  env: Env,
  row: SubmissionRow,
): Promise<{ newerId: string | null; olderId: string | null }> {
  const [newer, older] = await Promise.all([
    env.DB.prepare(
      `SELECT id FROM submissions
        WHERE created_at < ? OR (created_at = ? AND id < ?)
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
      .bind(row.created_at, row.created_at, row.id)
      .first<{ id: string }>(),
    env.DB.prepare(
      `SELECT id FROM submissions
        WHERE created_at > ? OR (created_at = ? AND id > ?)
        ORDER BY created_at ASC, id ASC LIMIT 1`,
    )
      .bind(row.created_at, row.created_at, row.id)
      .first<{ id: string }>(),
  ])

  return { newerId: newer?.id ?? null, olderId: older?.id ?? null }
}
