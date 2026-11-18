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
import { loadForm, formView } from '../_lib/forms'

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

    // The drawer shows the stored field values under the form's own labels
    // (forms-reviews spec §7). A missing form row (legacy source) just means
    // the UI falls back to the raw keys.
    const form = await loadForm(context.env, row.source)

    return json({
      item: submissionView(row),
      form: form ? formView(form) : null,
      neighbours: await neighbours(context.env, row),
    })
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
    const hasStarred = body.value.isStarred !== undefined
    const hasRead = body.value.read !== undefined
    if (!hasStatus && !hasNotes && !hasStarred && !hasRead) {
      return error('bad_request', 'Nothing to update')
    }

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

    // Star (forms-reviews spec §7): a boolean toggle.
    let isStarred = row.is_starred === 1
    if (hasStarred) {
      if (typeof body.value.isStarred !== 'boolean') {
        return error('bad_request', '`isStarred` must be a boolean')
      }
      isStarred = body.value.isStarred
    }

    // Read/unread: `read: true` stamps read_at; `read: false` clears it. The
    // status follows along when it is still in its default state, so a row can
    // never read "Read" while carrying an unread dot (spec §7).
    let readAt = row.read_at
    if (hasRead) {
      if (typeof body.value.read !== 'boolean') {
        return error('bad_request', '`read` must be a boolean')
      }
      readAt = body.value.read ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
      if (!hasStatus && body.value.read && status === 'new') status = 'read'
      if (!hasStatus && !body.value.read && status === 'read') status = 'new'
    }

    await context.env.DB.prepare(
      `UPDATE submissions
          SET status = ?, notes = ?, is_starred = ?, read_at = ?, handled_by = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(status, notes, isStarred ? 1 : 0, readAt, user.id, id)
      .run()

    await audit(
      context.env,
      actorOf(user),
      hasStatus ? 'status' : 'update',
      'submission',
      id,
      hasStatus
        ? `Marked submission ${status}`
        : hasStarred
          ? `${isStarred ? 'Starred' : 'Unstarred'} submission`
          : hasRead
            ? `Marked submission ${readAt ? 'read' : 'unread'}`
            : 'Updated internal notes',
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
