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
 * The CSV uses exactly the same filters as the inbox list. The export itself is
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
    })

    const { results } = await context.env.DB.prepare(
      `${SUBMISSION_SELECT} ${filter.where}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 5000`,
    )
      .bind(...filter.bindings)
      .all<SubmissionRow>()

    const rows = results ?? []
    const csv: unknown[][] = [
      [
        'id',
        'created_at',
        'source',
        'form',
        'status',
        'name',
        'email',
        'phone',
        'message',
        'extra_fields',
        'page_path',
        'referrer',
        'utm',
        'notes',
      ],
      ...rows.map((row) => [
        row.id,
        row.created_at,
        row.source,
        row.form_label ?? '',
        row.status,
        row.name ?? '',
        row.email ?? '',
        row.phone ?? '',
        row.message ?? '',
        row.fields,
        row.page_path ?? '',
        row.referrer ?? '',
        row.utm,
        row.notes,
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
