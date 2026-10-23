import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { FORM_SELECT, formView, loadForm, normaliseEmails } from '../_lib/forms'
import { isObject, readJsonBody, run, stringValue } from '../_lib/http'

/*
 * GET /api/admin/forms/:source — one source with counts
 * PUT /api/admin/forms/:source — label, enabled, notification emails, success copy
 *
 * The `source` is the public endpoint segment and can never change; changing it
 * would silently orphan submissions and break the live form.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const source = context.params.source
    if (!source) return error('bad_request', 'Missing form source')

    const row = await loadForm(context.env, source)
    if (!row) return error('not_found', 'No such form source')

    return json({ item: formView(row) })
  })

const update: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const source = context.params.source
    if (!source) return error('bad_request', 'Missing form source')

    const row = await loadForm(context.env, source)
    if (!row) return error('not_found', 'No such form source')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const labelInput = body.value.label
    if (labelInput !== undefined && (typeof labelInput !== 'string' || labelInput.trim().length === 0)) {
      return error('bad_request', 'Label must be a non-empty string')
    }
    const label = typeof labelInput === 'string' ? labelInput.trim().slice(0, 120) : row.label

    let enabled = row.enabled === 1
    if (body.value.enabled !== undefined) {
      if (typeof body.value.enabled !== 'boolean') {
        return error('bad_request', '`enabled` must be a boolean')
      }
      enabled = body.value.enabled
    }

    let emails = row.notify_emails
    if (body.value.notifyEmails !== undefined) {
      const normalised = normaliseEmails(body.value.notifyEmails)
      if (!normalised.ok) return normalised.response
      emails = JSON.stringify(normalised.emails)
    }

    let successMessage = row.success_message
    if (body.value.successMessage !== undefined) {
      const value = stringValue(body.value.successMessage)
      if (value === undefined) return error('bad_request', '`successMessage` must be a string')
      if (value.length > 500) return error('bad_request', 'Success message is limited to 500 characters')
      successMessage = value
    }

    await context.env.DB.prepare(
      `UPDATE forms
          SET label = ?, enabled = ?, notify_emails = ?, success_message = ?
        WHERE source = ?`,
    )
      .bind(label, enabled ? 1 : 0, emails, successMessage, source)
      .run()

    await audit(context.env, actorOf(user), 'update', 'form', source, `Updated form '${label}'`)

    const updated = await context.env.DB.prepare(`${FORM_SELECT} WHERE f.source = ?`)
      .bind(source)
      .first<Parameters<typeof formView>[0]>()

    if (!updated) return error('server_error', 'The form could not be read back')
    return json({ item: formView(updated) })
  })

export const onRequestPut = update
export const onRequestPatch = update
