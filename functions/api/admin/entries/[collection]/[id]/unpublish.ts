import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser, entryView, loadEntry } from '../../../_lib/db'
import { mediaMapFor } from '../../../_lib/media'
import { readExpectedVersion, run } from '../../../_lib/http'

/*
 * POST /api/admin/entries/:collection/:id/unpublish
 */

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const collection = context.params.collection
    const id = context.params.id
    if (!collection || !id) return error('bad_request', 'Missing entry id')

    const row = await loadEntry(context.env, collection, id)
    if (!row) return error('not_found', 'No such entry')

    const expectedVersion = await readExpectedVersion(context.request)
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return error('conflict', 'This entry changed in another tab. Reload before unpublishing.')
    }

    await context.env.DB.prepare(
      `UPDATE entries
          SET status = 'draft', version = version + 1,
              updated_at = datetime('now'), updated_by = ?
        WHERE collection = ? AND id = ?`,
    )
      .bind(user.id, collection, id)
      .run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'unpublish',
      'entry',
      id,
      `Unpublished ${collection} entry${row.slug ? ` '${row.slug}'` : ''}`,
    )

    const updated = await loadEntry(context.env, collection, id)
    if (!updated) return error('server_error', 'The entry could not be read back')

    const item = entryView(updated)
    const media = await mediaMapFor(context.env, item)
    return json({ item, media })
  })
