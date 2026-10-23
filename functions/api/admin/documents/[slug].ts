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
  isPlainObject,
  isSettingsDocument,
  isSingletonDocument,
  loadDocument,
  validateContent,
} from '../_lib/db'
import { mediaMapFor } from '../_lib/media'
import { isObject, numberValue, readJsonBody, run, stringValue } from '../_lib/http'

/*
 * GET    /api/admin/documents/:slug — draft + published snapshot + media map
 * PUT    /api/admin/documents/:slug — save the draft
 * DELETE /api/admin/documents/:slug — delete a page (admin)
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const slug = context.params.slug
    if (!slug) return error('bad_request', 'Missing document slug')

    const row = await loadDocument(context.env, slug)
    if (!row) return error('not_found', 'No such document')

    const item = documentView(row)
    const media = await mediaMapFor(context.env, [item.data, item.publishedData])
    return json({ item, media })
  })

export const onRequestPut: PagesFunction<Env> = (context) =>
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

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const expectedVersion = numberValue(body.value.expectedVersion)
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return error('conflict', 'This document changed in another tab. Reload before saving.')
    }

    const definition = documentDefinition(row.type)
    if (!definition) return error('server_error', 'This document has an unknown type')

    const incoming = body.value.data
    if (incoming !== undefined && !isPlainObject(incoming)) {
      return error('bad_request', '`data` must be an object')
    }
    const data = isPlainObject(incoming) ? incoming : (JSON.parse(row.data) as Record<string, unknown>)

    const validation = validateContent(definition.schema, definition.required, data, 'draft')
    if (!validation.ok) {
      return error('unprocessable', 'Some fields need attention', { fields: validation.errors })
    }

    const requestedTitle = stringValue(body.value.title)?.trim()
    const dataTitle = stringValue(validation.data.title)?.trim()
    const title =
      requestedTitle ||
      (row.type === 'page' && dataTitle ? dataTitle : row.title) ||
      row.title

    await context.env.DB.prepare(
      `UPDATE documents
          SET title = ?, data = ?, version = version + 1,
              updated_at = datetime('now'), updated_by = ?
        WHERE slug = ?`,
    )
      .bind(title, JSON.stringify(validation.data), user.id, slug)
      .run()

    const updated = await loadDocument(context.env, slug)
    if (!updated) return error('server_error', 'The document could not be read back')

    await audit(context.env, actorOf(user), 'update', 'document', slug, `Saved '${title}'`)

    const item = documentView(updated)
    const media = await mediaMapFor(context.env, [item.data, item.publishedData])
    return json({ item, media })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const slug = context.params.slug
    if (!slug) return error('bad_request', 'Missing document slug')
    if (isSingletonDocument(slug)) {
      return error('bad_request', 'Singleton settings documents cannot be deleted')
    }

    const row = await loadDocument(context.env, slug)
    if (!row) return error('not_found', 'No such document')

    await context.env.DB.prepare('DELETE FROM documents WHERE slug = ?').bind(slug).run()
    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'delete', 'document', slug, `Deleted '${row.title}'`)

    return json({ ok: true })
  })
