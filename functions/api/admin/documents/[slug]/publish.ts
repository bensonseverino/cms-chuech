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
  currentUser,
  documentDefinition,
  documentView,
  isSettingsDocument,
  loadDocument,
  validateContent,
} from '../../_lib/db'
import { mediaMapFor } from '../../_lib/media'
import { isObject, readExpectedVersion, run } from '../../_lib/http'

/*
 * POST /api/admin/documents/:slug/publish
 *
 * Publish is the only operation that changes what the public API serves. It
 * validates at the stricter `publish` level, copies `data` into
 * `published_data`, and bumps the content version so every edge cache key
 * changes at once.
 */

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const slug = context.params.slug
    if (!slug) return error('bad_request', 'Missing document slug')

    if (isSettingsDocument(slug)) {
      const adminError = requireRole(user, 'admin')
      if (adminError) return adminError
    }

    const row = await loadDocument(context.env, slug)
    if (!row) return error('not_found', 'No such document')

    const expectedVersion = await readExpectedVersion(context.request)
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return error('conflict', 'This document changed in another tab. Reload before publishing.')
    }

    const definition = documentDefinition(row.type)
    if (!definition) return error('server_error', 'This document has an unknown type')

    const data = JSON.parse(row.data) as Record<string, unknown>
    const validation = validateContent(definition.schema, definition.required, data, 'publish')
    if (!validation.ok) {
      return error('unprocessable', 'Some required fields are missing', {
        fields: validation.errors,
      })
    }

    const payload = JSON.stringify(validation.data)
    const statements = [
      context.env.DB.prepare(
        `UPDATE documents
            SET status = 'published', published_data = ?, published_at = datetime('now'),
                version = version + 1, updated_at = datetime('now'), updated_by = ?
          WHERE slug = ?`,
      ).bind(payload, user.id, slug),
    ]

    // A service page gets its two forms automatically (runbook §3): the hero
    // enquiry and the callback panel. `OR IGNORE` keeps an edited label.
    if (row.type === 'service_page') {
      const title = serviceTitle(validation.data) || row.title
      for (const suffix of ['hero', 'callback']) {
        const source = `${slug}-${suffix}`
        statements.push(
          context.env.DB.prepare(
            `INSERT OR IGNORE INTO forms
               (source, label, enabled, notify_emails, success_message, auto_registered)
             VALUES (?, ?, 1, '[]', '', 1)`,
          ).bind(source, `${title} ${suffix} form`),
        )
      }
    }

    await context.env.DB.batch(statements)
    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'publish', 'document', slug, `Published '${row.title}'`)

    const updated = await loadDocument(context.env, slug)
    if (!updated) return error('server_error', 'The document could not be read back')

    const item = documentView(updated)
    const media = await mediaMapFor(context.env, [item.data, item.publishedData])
    return json({ item, media })
  })

function serviceTitle(data: Record<string, unknown>): string | null {
  const hero = data.hero
  if (!isObject(hero)) return null
  const title = hero.title
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null
}
