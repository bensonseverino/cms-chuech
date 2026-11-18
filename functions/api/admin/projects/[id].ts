import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { PROJECT_INPUT_KEYS } from '@marino/content-schema'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run } from '../_lib/http'
import { mediaMapFor } from '../_lib/media'
import {
  categoryRowsForSlugs,
  loadProjectRow,
  loadProjectView,
  projectSaveStatements,
  validateProjectPayload,
} from '../_lib/projects'
import { reviewIdError } from '../_lib/reviews'

/*
 * GET    /api/admin/projects/:id — the editor payload (project + media + categories)
 * PUT    /api/admin/projects/:id — save the draft
 * DELETE /api/admin/projects/:id — delete (admin)
 *
 * A save runs as one D1 batch: slug history, category map, media usage and the
 * row. D1 batches are transactional, so a project can never end up with a new
 * gallery but stale `media_usage` rows.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const id = String(context.params.id ?? '')
    const view = await loadProjectView(context.env, id)
    if (!view) return error('not_found', 'No such project')

    const media = await mediaMapFor(context.env, view)
    return json({ item: view, media })
  })

export const onRequestPut: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const row = await loadProjectRow(context.env, id)
    if (!row) return error('not_found', 'No such project')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    const unknown = Object.keys(body.value).filter(
      (key) => key !== 'expectedVersion' && !(PROJECT_INPUT_KEYS as readonly string[]).includes(key),
    )
    if (unknown.length > 0) {
      return error('bad_request', `Unknown field(s): ${unknown.join(', ')}`)
    }

    const validation = validateProjectPayload(body.value, context.env)
    if (!validation.ok) {
      return error('unprocessable', 'Some fields need attention', { fields: validation.fields })
    }
    const input = validation.input

    const reviewError = await reviewIdError(context.env, input.reviewId)
    if (reviewError) return reviewError

    const categories = await categoryRowsForSlugs(context.env, input.categories ?? [])
    if (!categories) {
      return error('unprocessable', 'Some fields need attention', {
        fields: [{ path: 'categories', message: 'Choose from the existing categories' }],
      })
    }

    const nextSlug = input.slug ?? row.slug
    if (nextSlug !== row.slug) {
      const clash = await context.env.DB.prepare('SELECT id FROM projects WHERE slug = ? AND id != ?')
        .bind(nextSlug, id)
        .first<{ id: string }>()
      if (clash) {
        return error('unprocessable', 'Some fields need attention', {
          fields: [{ path: 'slug', message: 'That slug is already used by another project' }],
        })
      }

      const redirect = await context.env.DB.prepare(
        'SELECT project_id FROM project_slug_history WHERE slug = ? AND project_id != ?',
      )
        .bind(nextSlug, id)
        .first<{ project_id: string }>()
      if (redirect) {
        return error('unprocessable', 'Some fields need attention', {
          fields: [
            {
              path: 'slug',
              message: 'That slug is reserved as a redirect from an earlier rename',
            },
          ],
        })
      }
    }

    try {
      await context.env.DB.batch(
        projectSaveStatements(context.env, {
          id,
          currentSlug: row.slug,
          input,
          categories,
        }),
      )
    } catch (cause) {
      console.error('[admin/projects] save failed', cause)
      return error('conflict', 'Could not save that project (the slug may already exist)')
    }

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'update', 'project', id, `Saved '${nextSlug}'`)

    const view = await loadProjectView(context.env, id)
    if (!view) return error('server_error', 'The project could not be read back')
    return json({ item: view, media: await mediaMapFor(context.env, view) })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const row = await loadProjectRow(context.env, id)
    if (!row) return error('not_found', 'No such project')

    await context.env.DB.batch([
      context.env.DB.prepare('DELETE FROM media_usage WHERE entity = ? AND entity_id = ?').bind(
        'project',
        id,
      ),
      context.env.DB.prepare('DELETE FROM project_category_map WHERE project_id = ?').bind(id),
      context.env.DB.prepare('DELETE FROM project_slug_history WHERE project_id = ?').bind(id),
      context.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
    ])

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'delete', 'project', id, `Deleted '${row.slug}'`)

    return json({ ok: true })
  })
