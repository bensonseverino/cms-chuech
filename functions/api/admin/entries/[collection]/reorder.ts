import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, collectionDefinition, currentUser, entryView, type EntryRow } from '../../_lib/db'
import { mediaMapFor } from '../../_lib/media'
import { isObject, readJsonBody, run, stringArray } from '../../_lib/http'

/*
 * POST /api/admin/entries/:collection/reorder
 *
 * Reorder is a whole-list operation: the client sends every visible id in its
 * new order. Rejecting a partial list prevents a filtered table from silently
 * renumbering the entries the editor cannot see.
 */

const ENTRY_COLUMNS =
  'id, collection, slug, status, sort, data, published_data, version, published_at, updated_at, created_at'

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const collection = context.params.collection
    if (!collection || !collectionDefinition(collection)) {
      return error('not_found', 'Unknown collection')
    }

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const ids = stringArray(body.value.ids)
    if (!ids) return error('bad_request', '`ids` must be an array of entry ids')
    if (ids.length > 500) return error('bad_request', 'Too many entries in one reorder')

    const { results } = await context.env.DB.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE collection = ? ORDER BY sort, id`,
    )
      .bind(collection)
      .all<EntryRow>()

    const existing = results ?? []
    const existingIds = new Set(existing.map((row) => row.id))
    const submitted = new Set(ids)

    if (
      ids.length !== existing.length ||
      submitted.size !== ids.length ||
      ids.some((id) => !existingIds.has(id))
    ) {
      return error(
        'bad_request',
        'Reorder must include every entry in the collection exactly once',
      )
    }

    const statements = ids.map((id, index) =>
      context.env.DB.prepare(
        `UPDATE entries SET sort = ?, updated_at = datetime('now'), updated_by = ?
          WHERE collection = ? AND id = ?`,
      ).bind(index, user.id, collection, id),
    )

    await context.env.DB.batch(statements)
    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'reorder', 'entry', null, `Reordered ${collection}`)

    const { results: updated } = await context.env.DB.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE collection = ? ORDER BY sort, id`,
    )
      .bind(collection)
      .all<EntryRow>()

    const items = (updated ?? []).map(entryView)
    const media = await mediaMapFor(context.env, items)
    return json({ items, media })
  })
