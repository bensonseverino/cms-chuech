import {
  audit,
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
 * POST /api/admin/entries/:collection/:id/revert
 *
 * Restore the draft from the last published snapshot. The public API already
 * serves that snapshot, so no content-version bump is needed.
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
    if (row.published_data === null) {
      return error('conflict', 'This entry has never been published, so there is nothing to revert to')
    }

    const expectedVersion = await readExpectedVersion(context.request)
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return error('conflict', 'This entry changed in another tab. Reload before reverting.')
    }

    await context.env.DB.prepare(
      `UPDATE entries
          SET data = published_data, version = version + 1,
              updated_at = datetime('now'), updated_by = ?
        WHERE collection = ? AND id = ?`,
    )
      .bind(user.id, collection, id)
      .run()

    await audit(
      context.env,
      actorOf(user),
      'revert',
      'entry',
      id,
      `Reverted ${collection} entry${row.slug ? ` '${row.slug}'` : ''} to its published snapshot`,
    )

    const updated = await loadEntry(context.env, collection, id)
    if (!updated) return error('server_error', 'The entry could not be read back')

    const item = entryView(updated)
    const media = await mediaMapFor(context.env, item)
    return json({ item, media })
  })
