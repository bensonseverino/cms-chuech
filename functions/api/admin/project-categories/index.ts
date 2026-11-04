import {
  audit,
  bumpContentVersion,
  error,
  json,
  newId,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { slugify, PROJECT_LIMITS } from '@marino/content-schema'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run } from '../_lib/http'

/*
 * GET  /api/admin/project-categories — categories with usage counts
 * POST /api/admin/project-categories — create
 *
 * Deleting is guarded in [id].ts; that is the only destructive operation here.
 */

export type CategoryListRow = {
  id: string
  slug: string
  label: string
  position: number
  projectCount: number
}

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const { results } = await context.env.DB.prepare(
      `SELECT c.id, c.slug, c.label, c.position,
              (SELECT COUNT(*) FROM project_category_map m WHERE m.category_id = c.id) AS projectCount
         FROM project_categories c
        ORDER BY c.position ASC, c.label ASC`,
    ).all<CategoryListRow>()

    return json({ items: results ?? [] })
  })

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const label = typeof body.value.label === 'string' ? body.value.label.trim() : ''
    if (!label) return error('bad_request', 'A category needs a label')
    if (label.length > PROJECT_LIMITS.categoryLabel) {
      return error('bad_request', 'That label is too long')
    }

    const rawSlug = typeof body.value.slug === 'string' ? body.value.slug.trim() : ''
    const slug = rawSlug || slugify(label, PROJECT_LIMITS.categorySlug)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return error('bad_request', 'The slug must be lowercase letters, numbers and hyphens')
    }

    const clash = await context.env.DB.prepare('SELECT id FROM project_categories WHERE slug = ?')
      .bind(slug)
      .first<{ id: string }>()
    if (clash) return error('conflict', 'A category with that slug already exists')

    const maxRow = await context.env.DB.prepare(
      'SELECT COALESCE(MAX(position), -1) AS max_position FROM project_categories',
    ).first<{ max_position: number }>()

    const id = newId()
    const position = (maxRow?.max_position ?? -1) + 1

    await context.env.DB.prepare(
      `INSERT INTO project_categories (id, slug, label, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(id, slug, label, position)
      .run()

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'create', 'project_category', id, `Added '${label}'`)

    return json({ item: { id, slug, label, position, projectCount: 0 } }, { status: 201 })
  })
