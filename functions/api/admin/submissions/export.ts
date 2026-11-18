import { audit, error, requireRole, type Env, type PagesFunction } from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import {
  SUBMISSION_SELECT,
  buildSubmissionFilter,
  isSubmissionStatus,
  type SubmissionRow,
} from '../_lib/submissions'
import { csvResponse, datedFilename, isIsoDate, run } from '../_lib/http'

/*
 * GET /api/admin/submissions/export
 *
 * The CSV uses exactly the same filters as the inbox list (including unread
 * and starred). Columns: Submitted at, Status, Form, Page/Project, then one
 * column per field label (forms-reviews spec §6). The export itself is
 * audited, because downloading every lead is a meaningful action.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const url = new URL(context.request.url)
    const source = url.searchParams.get('source')?.trim()
    const status = url.searchParams.get('status')?.trim()
    const q = url.searchParams.get('q')?.trim()
    const from = url.searchParams.get('from')?.trim()
    const to = url.searchParams.get('to')?.trim()
    const project = url.searchParams.get('project')?.trim()
    const unread = ['1', 'true'].includes(url.searchParams.get('unread') ?? '')
    const starred = ['1', 'true'].includes(url.searchParams.get('starred') ?? '')

    if (status && status !== 'all' && !isSubmissionStatus(status)) {
      return error('bad_request', 'Unknown submission status')
    }
    if (from && !isIsoDate(from)) return error('bad_request', '`from` must be YYYY-MM-DD')
    if (to && !isIsoDate(to)) return error('bad_request', '`to` must be YYYY-MM-DD')

    const filter = buildSubmissionFilter({
      source: source && source.length > 0 ? source : undefined,
      status: status && status !== 'all' ? status : undefined,
      q: q && q.length > 0 ? q.slice(0, 200) : undefined,
      from: from && from.length > 0 ? from : undefined,
      to: to && to.length > 0 ? to : undefined,
      project: project && project.length > 0 ? project.slice(0, 200) : undefined,
      unread,
      starred,
    })

    const { results } = await context.env.DB.prepare(
      `${SUBMISSION_SELECT} ${filter.where}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 5000`,
    )
      .bind(...filter.bindings)
      .all<SubmissionRow>()

    const rows = results ?? []

    // Field-key to label map from the form definitions, so the CSV shows
    // "Your name" instead of `name`. Keys with no definition keep their raw id.
    const valuesByRow = await fieldData(context.env, rows)

    // One column per field label, ordered by first appearance in the data.
    const columns: string[] = []
    for (const { values } of valuesByRow) {
      for (const key of values.keys()) {
        if (!columns.includes(key)) columns.push(key)
      }
    }

    const csv: unknown[][] = [
      ['Submitted at', 'Status', 'Form', 'Page/Project', ...columns],
      ...valuesByRow.map(({ row, values }) => [
        row.created_at,
        row.status,
        row.form_label ?? row.source,
        pageProject(row),
        ...columns.map((key) => cellValue(values.get(key))),
      ]),
    ]

    await audit(
      context.env,
      actorOf(user),
      'bulk',
      'submission',
      null,
      `Exported ${rows.length} submission${rows.length === 1 ? '' : 's'} to CSV`,
    )

    return csvResponse(datedFilename('submissions'), csv)
  })

type FieldValues = Map<string, string>

/**
 * Parse each row's `fields` JSON into display columns keyed by label (falling
 * back to the raw key), skipping the legacy `_context` bookkeeping key.
 */
async function fieldData(env: Env, rows: SubmissionRow[]) {
  const defLabels = new Map<string, Map<string, string>>()
  for (const source of new Set(rows.map((row) => row.source))) {
    const form = await env.DB.prepare('SELECT fields FROM forms WHERE source = ?')
      .bind(source)
      .first<{ fields: string | null }>()
    defLabels.set(source, labelMap(form?.fields ?? null))
  }

  const valuesByRow = rows.map((row) => {
    const labels = defLabels.get(row.source) ?? new Map<string, string>()
    const values: FieldValues = new Map()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = (JSON.parse(row.fields || '{}') as unknown) as Record<string, unknown>
    } catch {
      parsed = {}
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('_')) continue
      const label = labels.get(key) ?? key
      values.set(label, displayValue(value))
    }
    return { row, values }
  })

  return valuesByRow
}

/** Field-key to label pairs from a form definition JSON. */
function labelMap(raw: string | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!raw) return out
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return out
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const def = item as { id?: unknown; label?: unknown }
      if (typeof def.id === 'string' && typeof def.label === 'string' && def.label) {
        out.set(def.id, def.label.replace(/\*$/, '').trim())
      }
    }
  } catch {
    // Hand-edited definition: the raw keys will be used instead.
  }
  return out
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** "Page/Project" column: the case study title, else the page path. */
function pageProject(row: SubmissionRow): string {
  for (const raw of [row.context, row.fields]) {
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as {
        projectTitle?: unknown
        projectSlug?: unknown
        _context?: { projectTitle?: unknown; projectSlug?: unknown }
      }
      const candidates = [
        parsed.projectTitle,
        parsed.projectSlug,
        parsed._context?.projectTitle,
        parsed._context?.projectSlug,
      ]
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate) return candidate
      }
    } catch {
      // Fall through to page_path below.
    }
  }
  return row.page_path ?? ''
}

function cellValue(value: string | undefined): string {
  return value ?? ''
}
