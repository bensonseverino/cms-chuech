import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { PROJECT_LIMITS, slugify } from '@marino/content-schema'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run } from '../_lib/http'

/*
 * PUT    /api/admin/project-categories/:id — rename / re-slug / reposition
 * DELETE /api/admin/project-categories/:id — refused while projects use it
 *
 * Renaming is safe for projects because the map stores category ids, not
 * labels. The slug is checked for uniqueness because project category filters
 * in URLs use it.
 */

export const onRequestPut: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const row = await context.env.DB.prepare(
      'SELECT id, slug, label, position FROM project_categories WHERE id = ?',
    )
      .bind(id)
      .first<{ id: string; slug: string; label: string; position: number }>()
    if (!row) return error('not_found', 'No such category')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const label =
      body.value.label === undefined
        ? row.label
        : typeof body.value.label === 'string'
          ? body.value.label.trim()
          : ''
    if (!label) return error('bad_request', 'A category needs a label')
    if (label.length > PROJECT_LIMITS.categoryLabel) {
      return error('bad_request', 'That label is too long')
    }

    let slug = row.slug
    if (body.value.slug !== undefined) {
      if (typeof body.value.slug !== 'string') return error('bad_request', '`slug` must be a string')
      slug = body.value.slug.trim() || slugify(label, PROJECT_LIMITS.categorySlug)
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return error('bad_request', 'The slug must be lowercase letters, numbers and hyphens')
      }
    }

    if (slug !== row.slug) {
      const clash = await context.env.DB.prepare(
        'SELECT id FROM project_categories WHERE slug = ? AND id != ?',
      )
        .bind(slug, id)
        .first<{ id: string }>()
      if (clash) return error('conflict', 'A category with that slug already exists')
    }

    let position = row.position
    if (body.value.position !== undefined) {
      if (typeof body.value.position !== 'number' || !Number.isFinite(body.value.position)) {
        return error('bad_request', '`position` must be a number')
      }
      position = Math.max(0, Math.floor(body.value.position))
    }

    await context.env.DB.prepare(
      `UPDATE project_categories SET slug = ?, label = ?, position = ?,
         updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(slug, label, position, id)
      .run()

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'update', 'project_category', id, `Updated '${label}'`)

    const count = await context.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM project_category_map WHERE category_id = ?',
    )
      .bind(id)
      .first<{ count: number }>()

    return json({ item: { id, slug, label, position, projectCount: count?.count ?? 0 } })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const row = await context.env.DB.prepare(
      'SELECT id, label FROM project_categories WHERE id = ?',
    )
      .bind(id)
      .first<{ id: string; label: string }>()
    if (!row) return error('not_found', 'No such category')

    const count = await context.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM project_category_map WHERE category_id = ?',
    )
      .bind(id)
      .first<{ count: number }>()

    const used = count?.count ?? 0
    if (used > 0) {
      return error(
        'conflict',
        `'${row.label}' is used by ${used} project${used === 1 ? '' : 's'}. Remove it from them first.`,
      )
    }

    await context.env.DB.prepare('DELETE FROM project_categories WHERE id = ?').bind(id).run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'delete',
      'project_category',
      id,
      `Deleted '${row.label}'`,
    )

    return json({ ok: true })
  })
