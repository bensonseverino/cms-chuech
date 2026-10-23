import {
  audit,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { isValidSlug, slugify } from '@marino/content-schema'
import {
  actorOf,
  currentUser,
  documentDefinition,
  documentView,
  isPlainObject,
  loadDocument,
  validateContent,
  type DocumentRow,
} from '../_lib/db'
import { mediaMapFor } from '../_lib/media'
import { isObject, readJsonBody, run, stringValue } from '../_lib/http'

/*
 * GET  /api/admin/documents — every document, drafts included.
 * POST /api/admin/documents — create a page or service page.
 *
 * Singleton documents are created by the seed/migration; the CMS only creates
 * slugged pages. A singleton is addressed by its fixed underscore slug.
 */

const DOCUMENT_COLUMNS =
  'slug, type, title, status, data, published_data, version, published_at, updated_at, created_at'

const STATUSES = new Set(['draft', 'published', 'archived'])

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const url = new URL(context.request.url)
    const type = url.searchParams.get('type')?.trim()
    const status = url.searchParams.get('status')?.trim()
    const q = url.searchParams.get('q')?.trim()

    if (status && !STATUSES.has(status)) return error('bad_request', 'Unknown status filter')

    const conditions: string[] = []
    const bindings: unknown[] = []

    if (type) {
      conditions.push('type = ?')
      bindings.push(type)
    }
    if (status) {
      conditions.push('status = ?')
      bindings.push(status)
    }
    if (q) {
      conditions.push('(title LIKE ? OR slug LIKE ?)')
      bindings.push(`%${q}%`, `%${q}%`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const { results } = await context.env.DB.prepare(
      `SELECT ${DOCUMENT_COLUMNS} FROM documents
        ${where}
        ORDER BY CASE type
          WHEN 'site' THEN 0
          WHEN 'navigation' THEN 1
          WHEN 'footer' THEN 2
          WHEN 'home' THEN 3
          WHEN 'services_index' THEN 4
          WHEN 'work_index' THEN 5
          WHEN 'service_page' THEN 6
          ELSE 7
        END, title COLLATE NOCASE, slug`,
    )
      .bind(...bindings)
      .all<DocumentRow>()

    return json({ items: (results ?? []).map(documentView) })
  })

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const type = stringValue(body.value.type)?.trim() ?? ''
    if (type !== 'page' && type !== 'service_page') {
      return error('bad_request', 'Only page and service_page documents can be created here')
    }

    const definition = documentDefinition(type)
    if (!definition) return error('bad_request', 'Unknown document type')

    const dataInput = body.value.data
    if (dataInput !== undefined && !isPlainObject(dataInput)) {
      return error('bad_request', '`data` must be an object')
    }
    const data = isPlainObject(dataInput) ? dataInput : {}
    const dataTitle = stringValue(data.title)
    const title =
      stringValue(body.value.title)?.trim() || dataTitle?.trim() || definition.label

    const requestedSlug = stringValue(body.value.slug)?.trim()
    const slug = requestedSlug && requestedSlug.length > 0 ? requestedSlug : slugify(title)
    if (!isValidSlug(slug)) {
      return error('bad_request', 'Use a slug made of lowercase letters, numbers and hyphens')
    }
    if (slug.startsWith('_')) {
      return error('bad_request', 'Underscore slugs are reserved for singletons')
    }

    const validation = validateContent(definition.schema, definition.required, data, 'draft')
    if (!validation.ok) {
      return error('unprocessable', 'Some fields need attention', { fields: validation.errors })
    }

    const existing = await loadDocument(context.env, slug)
    if (existing) return error('conflict', `A document already exists at '${slug}'`)

    try {
      await context.env.DB.prepare(
        `INSERT INTO documents (slug, type, title, status, data, updated_by)
         VALUES (?, ?, ?, 'draft', ?, ?)`,
      )
        .bind(slug, type, title, JSON.stringify(validation.data), user.id)
        .run()
    } catch (cause) {
      console.error('[admin/documents] create failed', cause)
      return error('conflict', 'Could not create that document (slug may already exist)')
    }

    const row = await loadDocument(context.env, slug)
    if (!row) return error('server_error', 'The document was created but could not be read back')

    const view = documentView(row)
    const media = await mediaMapFor(context.env, [view.data, view.publishedData])

    await audit(
      context.env,
      actorOf(user),
      'create',
      'document',
      slug,
      `Created ${type} '${title}'`,
    )

    return json({ item: view, media }, { status: 201 })
  })
