import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import {
  actorOf,
  collectionDefinition,
  currentUser,
  entrySlug,
  entryView,
  isPlainObject,
  loadEntry,
  validateContent,
} from '../../_lib/db'
import { mediaMapFor } from '../../_lib/media'
import { isObject, numberValue, readJsonBody, run } from '../../_lib/http'

/*
 * GET    /api/admin/entries/:collection/:id — raw draft + snapshot + media map
 * PUT    /api/admin/entries/:collection/:id — save the draft
 * DELETE /api/admin/entries/:collection/:id — delete (admin)
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const collection = context.params.collection
    const id = context.params.id
    if (!collection || !id) return error('bad_request', 'Missing entry id')

    const row = await loadEntry(context.env, collection, id)
    if (!row) return error('not_found', 'No such entry')

    const item = entryView(row)
    const media = await mediaMapFor(context.env, item)
    return json({ item, media })
  })

export const onRequestPut: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const collection = context.params.collection
    const id = context.params.id
    if (!collection || !id) return error('bad_request', 'Missing entry id')

    const definition = collectionDefinition(collection)
    if (!definition) return error('not_found', 'Unknown collection')

    const row = await loadEntry(context.env, collection, id)
    if (!row) return error('not_found', 'No such entry')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const expectedVersion = numberValue(body.value.expectedVersion)
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return error('conflict', 'This entry changed in another tab. Reload before saving.')
    }

    const incoming = body.value.data
    if (incoming !== undefined && !isPlainObject(incoming)) {
      return error('bad_request', '`data` must be an object')
    }
    const data = isPlainObject(incoming) ? incoming : (JSON.parse(row.data) as Record<string, unknown>)

    const validation = validateContent(definition.schema, definition.required, data, 'draft')
    if (!validation.ok) {
      return error('unprocessable', 'Some fields need attention', { fields: validation.errors })
    }

    const slug = entrySlug(collection, validation.data)
    if (row.status === 'published' && slug !== row.slug) {
      return error('conflict', 'The slug cannot change once the entry is published. Unpublish it first.')
    }

    const dataSort = typeof validation.data.sort === 'number' ? validation.data.sort : undefined
    const bodySort = numberValue(body.value.sort)
    const sort = dataSort ?? bodySort ?? row.sort
    const stored = { ...validation.data, sort }

    await context.env.DB.prepare(
      `UPDATE entries
          SET slug = ?, sort = ?, data = ?, version = version + 1,
              updated_at = datetime('now'), updated_by = ?
        WHERE collection = ? AND id = ?`,
    )
      .bind(slug, sort, JSON.stringify(stored), user.id, collection, id)
      .run()

    const updated = await loadEntry(context.env, collection, id)
    if (!updated) return error('server_error', 'The entry could not be read back')

    await audit(
      context.env,
      actorOf(user),
      'update',
      'entry',
      id,
      `Saved ${collection} entry${slug ? ` '${slug}'` : ''}`,
    )

    const item = entryView(updated)
    const media = await mediaMapFor(context.env, item)
    return json({ item, media })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const collection = context.params.collection
    const id = context.params.id
    if (!collection || !id) return error('bad_request', 'Missing entry id')

    const row = await loadEntry(context.env, collection, id)
    if (!row) return error('not_found', 'No such entry')

    await context.env.DB.prepare('DELETE FROM entries WHERE collection = ? AND id = ?')
      .bind(collection, id)
      .run()
    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'delete',
      'entry',
      id,
      `Deleted ${collection} entry${row.slug ? ` '${row.slug}'` : ''}`,
    )

    return json({ ok: true })
  })
