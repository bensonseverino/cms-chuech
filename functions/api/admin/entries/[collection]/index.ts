import {
  audit,
  error,
  json,
  newId,
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
  validateContent,
  type EntryRow,
} from '../../_lib/db'
import { mediaMapFor } from '../../_lib/media'
import { isObject, readJsonBody, run } from '../../_lib/http'

/*
 * GET  /api/admin/entries/:collection — all entries in one collection
 * POST /api/admin/entries/:collection — create an entry
 *
 * The collection is a discriminator, not a separate table: the schema and
 * FieldDef catalog come from `@marino/content-schema`, exactly like documents.
 */

const ENTRY_COLUMNS =
  'id, collection, slug, status, sort, data, published_data, version, published_at, updated_at, created_at'
const STATUSES = new Set(['draft', 'published', 'archived'])

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const collection = context.params.collection
    if (!collection || !collectionDefinition(collection)) {
      return error('not_found', 'Unknown collection')
    }

    const url = new URL(context.request.url)
    const status = url.searchParams.get('status')?.trim()
    const q = url.searchParams.get('q')?.trim()
    if (status && !STATUSES.has(status)) return error('bad_request', 'Unknown status filter')

    const conditions = ['collection = ?']
    const bindings: unknown[] = [collection]

    if (status) {
      conditions.push('status = ?')
      bindings.push(status)
    }
    if (q) {
      conditions.push('(slug LIKE ? OR data LIKE ?)')
      bindings.push(`%${q}%`, `%${q}%`)
    }

    const { results } = await context.env.DB.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM entries
        WHERE ${conditions.join(' AND ')}
        ORDER BY sort ASC, COALESCE(slug, id) ASC`,
    )
      .bind(...bindings)
      .all<EntryRow>()

    const items = (results ?? []).map(entryView)
    const media = await mediaMapFor(context.env, items)
    return json({ items, media })
  })

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const collection = context.params.collection
    const definition = collection ? collectionDefinition(collection) : null
    if (!collection || !definition) return error('not_found', 'Unknown collection')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const incoming = body.value.data
    if (incoming !== undefined && !isPlainObject(incoming)) {
      return error('bad_request', '`data` must be an object')
    }

    const data = isPlainObject(incoming) ? incoming : {}
    const validation = validateContent(definition.schema, definition.required, data, 'draft')
    if (!validation.ok) {
      return error('unprocessable', 'Some fields need attention', { fields: validation.errors })
    }

    const maxRow = await context.env.DB.prepare(
      'SELECT COALESCE(MAX(sort), -1) AS max_sort FROM entries WHERE collection = ?',
    )
      .bind(collection)
      .first<{ max_sort: number }>()

    const dataSort = typeof validation.data.sort === 'number' ? validation.data.sort : undefined
    const bodySort = typeof body.value.sort === 'number' ? body.value.sort : undefined
    const sort = dataSort ?? bodySort ?? (maxRow?.max_sort ?? -1) + 1

    const id = newId()
    const slug = entrySlug(collection, validation.data)
    const stored = { ...validation.data, sort }

    try {
      await context.env.DB.prepare(
        `INSERT INTO entries
           (id, collection, slug, status, sort, data, created_by, updated_by)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
      )
        .bind(id, collection, slug, sort, JSON.stringify(stored), user.id, user.id)
        .run()
    } catch (cause) {
      console.error('[admin/entries] create failed', cause)
      return error('conflict', 'Could not create that entry (slug may already exist)')
    }

    const row = await context.env.DB.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`)
      .bind(id)
      .first<EntryRow>()
    if (!row) return error('server_error', 'The entry was created but could not be read back')

    const item = entryView(row)
    const media = await mediaMapFor(context.env, item)

    await audit(
      context.env,
      actorOf(user),
      'create',
      'entry',
      id,
      `Created ${collection} entry${slug ? ` '${slug}'` : ''}`,
    )

    return json({ item, media }, { status: 201 })
  })
