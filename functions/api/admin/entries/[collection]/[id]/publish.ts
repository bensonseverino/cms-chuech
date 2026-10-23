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
  entryView,
  loadEntry,
  parseObject,
  validateContent,
} from '../../../_lib/db'
import { mediaMapFor } from '../../../_lib/media'
import { readExpectedVersion, run } from '../../../_lib/http'

/*
 * POST /api/admin/entries/:collection/:id/publish
 */

export const onRequestPost: PagesFunction<Env> = (context) =>
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

    const expectedVersion = await readExpectedVersion(context.request)
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return error('conflict', 'This entry changed in another tab. Reload before publishing.')
    }

    const data = JSON.parse(row.data) as Record<string, unknown>
    const validation = validateContent(definition.schema, definition.required, data, 'publish')
    if (!validation.ok) {
      return error('unprocessable', 'Some required fields are missing', {
        fields: validation.errors,
      })
    }

    if (collection === 'projects') {
      const unknown = await unknownServices(context.env, validation.data)
      if (unknown.length > 0) {
        return error('unprocessable', 'Some required fields need attention', {
          fields: unknown.map((name) => ({
            path: 'services',
            message: `No service titled '${name}' exists`,
          })),
        })
      }
    }

    await context.env.DB.prepare(
      `UPDATE entries
          SET status = 'published', published_data = ?, published_at = datetime('now'),
              version = version + 1, updated_at = datetime('now'), updated_by = ?
        WHERE collection = ? AND id = ?`,
    )
      .bind(JSON.stringify(validation.data), user.id, collection, id)
      .run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'publish',
      'entry',
      id,
      `Published ${collection} entry${row.slug ? ` '${row.slug}'` : ''}`,
    )

    const updated = await loadEntry(context.env, collection, id)
    if (!updated) return error('server_error', 'The entry could not be read back')

    const item = entryView(updated)
    const media = await mediaMapFor(context.env, item)
    return json({ item, media })
  })

/** Projects tag themselves with service titles; a typo would make the filter lie. */
async function unknownServices(
  env: Env,
  data: Record<string, unknown>,
): Promise<string[]> {
  const services = data.services
  if (!Array.isArray(services)) return []

  const requested = services.filter((value): value is string => typeof value === 'string')
  if (requested.length === 0) return []

  const { results } = await env.DB.prepare(
    `SELECT data FROM entries WHERE collection = 'services' AND status != 'archived'`,
  ).all<{ data: string }>()

  const known = new Set<string>()
  for (const row of results ?? []) {
    const parsed = parseObject(row.data) ?? {}
    if (typeof parsed.title === 'string') known.add(parsed.title)
  }

  return requested.filter((title) => !known.has(title))
}
