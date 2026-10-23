import { error, json, type Env, type PagesFunction } from '@marino/api-kit'
import {
  SUBMISSION_SELECT,
  buildSubmissionFilter,
  isSubmissionStatus,
  submissionView,
  type SubmissionFilters,
  type SubmissionRow,
} from '../_lib/submissions'
import { isIsoDate, pageParams, run } from '../_lib/http'

/*
 * GET /api/admin/submissions — the inbox, filtered and paginated.
 *
 * The response carries per-status counts computed with the same source/search/
 * date filters but without the status filter, so the filter pills can show how
 * many rows each choice would reveal.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const url = new URL(context.request.url)
    const { page, limit, offset } = pageParams(url, 25, 100)
    const filters = readFilters(url)

    if (!filters.ok) return error('bad_request', filters.error)
    const parsed = filters.filters

    const withStatus = buildSubmissionFilter(parsed, true)
    const countRow = await context.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM submissions s ${withStatus.where}`,
    )
      .bind(...withStatus.bindings)
      .first<{ count: number }>()

    const { results } = await context.env.DB.prepare(
      `${SUBMISSION_SELECT} ${withStatus.where}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?`,
    )
      .bind(...withStatus.bindings, limit, offset)
      .all<SubmissionRow>()

    const withoutStatus = buildSubmissionFilter({ ...parsed, status: undefined }, true)
    const { results: countRows } = await context.env.DB.prepare(
      `SELECT s.status, COUNT(*) AS count FROM submissions s
        ${withoutStatus.where}
        GROUP BY s.status`,
    )
      .bind(...withoutStatus.bindings)
      .all<{ status: string; count: number }>()

    const counts: Record<string, number> = {
      new: 0,
      read: 0,
      replied: 0,
      spam: 0,
      archived: 0,
    }
    for (const row of countRows ?? []) counts[row.status] = row.count

    return json({
      items: (results ?? []).map(submissionView),
      total: countRow?.count ?? 0,
      page,
      limit,
      counts,
    })
  })

type FilterResult =
  | { ok: true; filters: SubmissionFilters }
  | { ok: false; error: string }

function readFilters(url: URL): FilterResult {
  const source = url.searchParams.get('source')?.trim()
  const status = url.searchParams.get('status')?.trim()
  const q = url.searchParams.get('q')?.trim()
  const from = url.searchParams.get('from')?.trim()
  const to = url.searchParams.get('to')?.trim()

  if (status && status !== 'all' && !isSubmissionStatus(status)) {
    return { ok: false, error: 'Unknown submission status' }
  }
  if (from && !isIsoDate(from)) return { ok: false, error: '`from` must be YYYY-MM-DD' }
  if (to && !isIsoDate(to)) return { ok: false, error: '`to` must be YYYY-MM-DD' }

  return {
    ok: true,
    filters: {
      source: source && source.length > 0 ? source.slice(0, 120) : undefined,
      status: status && status !== 'all' ? status : undefined,
      q: q && q.length > 0 ? q.slice(0, 200) : undefined,
      from: from && from.length > 0 ? from : undefined,
      to: to && to.length > 0 ? to : undefined,
    },
  }
}
