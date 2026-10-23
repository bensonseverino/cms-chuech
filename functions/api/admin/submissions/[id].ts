import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import {
  isSubmissionStatus,
  loadSubmission,
  neighbours,
  submissionView,
} from '../_lib/submissions'
import { isObject, readJsonBody, run, stringValue } from '../_lib/http'

/*
 * GET    /api/admin/submissions/:id — one submission + its neighbours
 * PATCH  /api/admin/submissions/:id — status and internal notes
 * DELETE /api/admin/submissions/:id — permanent delete (admin)
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const id = context.params.id
    if (!id) return error('bad_request', 'Missing submission id')

    const row = await loadSubmission(context.env, id)
    if (!row) return error('not_found', 'No such submission')

    return json({ item: submissionView(row), neighbours: await neighbours(context.env, row) })
  })

export const onRequestPatch: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = context.params.id
    if (!id) return error('bad_request', 'Missing submission id')

    const row = await loadSubmission(context.env, id)
    if (!row) return error('not_found', 'No such submission')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const hasStatus = body.value.status !== undefined
    const hasNotes = body.value.notes !== undefined
    if (!hasStatus && !hasNotes) return error('bad_request', 'Nothing to update')

    let status = row.status
    if (hasStatus) {
      const value = stringValue(body.value.status)
      if (!value || !isSubmissionStatus(value)) {
        return error('bad_request', 'Unknown submission status')
      }
      status = value
    }

    let notes = row.notes
    if (hasNotes) {
      const value = stringValue(body.value.notes)
      if (value === undefined) return error('bad_request', '`notes` must be a string')
      if (value.length > 5000) return error('bad_request', 'Notes are limited to 5000 characters')
      notes = value
    }

    await context.env.DB.prepare(
      `UPDATE submissions
          SET status = ?, notes = ?, handled_by = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(status, notes, user.id, id)
      .run()

    await audit(
      context.env,
      actorOf(user),
      hasStatus ? 'status' : 'update',
      'submission',
      id,
      hasStatus ? `Marked submission ${status}` : 'Updated internal notes',
    )

    const updated = await loadSubmission(context.env, id)
    if (!updated) return error('server_error', 'The submission could not be read back')

    return json({ item: submissionView(updated) })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const id = context.params.id
    if (!id) return error('bad_request', 'Missing submission id')

    const row = await loadSubmission(context.env, id)
    if (!row) return error('not_found', 'No such submission')

    await context.env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run()
    await audit(
      context.env,
      actorOf(user),
      'delete',
      'submission',
      id,
      `Deleted submission from ${row.source}`,
    )

    return json({ ok: true })
  })
