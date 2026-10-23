import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { findMediaUsage, loadMedia, mediaView } from '../_lib/media'
import { isObject, readJsonBody, run, stringArray } from '../_lib/http'

/*
 * GET    /api/admin/media/:id — one item + where it is used
 * PATCH  /api/admin/media/:id — alt text, focus point, tags, poster
 * DELETE /api/admin/media/:id — soft delete, refused while referenced (admin)
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const id = context.params.id
    if (!id) return error('bad_request', 'Missing media id')

    const row = await loadMedia(context.env, id)
    if (!row) return error('not_found', 'No such media item')

    const usage = await findMediaUsage(context.env, id)
    return json({ item: mediaView(context.env, row), usage })
  })

export const onRequestPatch: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = context.params.id
    if (!id) return error('bad_request', 'Missing media id')

    const row = await loadMedia(context.env, id)
    if (!row) return error('not_found', 'No such media item')

    const body = await readJsonBody(context.request)
    if (!body.ok) return body.response
    if (!isObject(body.value)) return error('bad_request', 'Expected a JSON object')

    let alt = row.alt
    if (body.value.alt !== undefined) {
      if (typeof body.value.alt !== 'string') return error('bad_request', '`alt` must be a string')
      if (body.value.alt.length > 300) return error('bad_request', 'Alt text is limited to 300 characters')
      alt = body.value.alt
    }

    let focusX = row.focus_x
    let focusY = row.focus_y
    if (body.value.focus === null) {
      focusX = null
      focusY = null
    } else if (body.value.focus !== undefined) {
      const focus = body.value.focus
      if (!isObject(focus)) return error('bad_request', '`focus` must be { x, y } or null')
      const x = focus.x
      const y = focus.y
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1
      ) {
        return error('bad_request', 'Focus x and y must be between 0 and 1')
      }
      focusX = x
      focusY = y
    }

    let tags = row.tags
    if (body.value.tags !== undefined) {
      const parsed = stringArray(body.value.tags)
      if (!parsed) return error('bad_request', '`tags` must be an array of strings')
      const clean = parsed.map((tag) => tag.trim()).filter(Boolean).slice(0, 30)
      if (clean.some((tag) => tag.length > 40)) {
        return error('bad_request', 'Each tag is limited to 40 characters')
      }
      tags = JSON.stringify(clean)
    }

    let posterId = row.poster_media_id
    if (body.value.posterId !== undefined) {
      if (body.value.posterId === null) {
        posterId = null
      } else if (typeof body.value.posterId === 'string') {
        if (body.value.posterId === id) return error('bad_request', 'A video cannot be its own poster')
        const poster = await loadMedia(context.env, body.value.posterId)
        if (!poster || (poster.kind !== 'image' && poster.kind !== 'svg')) {
          return error('bad_request', 'The poster must be an image in the media library')
        }
        posterId = poster.id
      } else {
        return error('bad_request', '`posterId` must be a media id or null')
      }
    }

    await context.env.DB.prepare(
      `UPDATE media
          SET alt = ?, focus_x = ?, focus_y = ?, tags = ?, poster_media_id = ?
        WHERE id = ? AND deleted_at IS NULL`,
    )
      .bind(alt, focusX, focusY, tags, posterId, id)
      .run()

    // Alt text and focus are part of the resolved public shape, so a change
    // must invalidate the public cache.
    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'update', 'media', id, `Updated ${row.filename}`)

    const updated = await loadMedia(context.env, id)
    if (!updated) return error('server_error', 'The item could not be read back')

    const usage = await findMediaUsage(context.env, id)
    return json({ item: mediaView(context.env, updated), usage })
  })

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const id = context.params.id
    if (!id) return error('bad_request', 'Missing media id')

    const row = await loadMedia(context.env, id)
    if (!row) return error('not_found', 'No such media item')

    const usage = await findMediaUsage(context.env, id)
    if (usage.length > 0) {
      const first = usage
        .slice(0, 3)
        .map((item) => (item.kind === 'document' ? item.title : item.label))
        .join(', ')
      return error(
        'conflict',
        `This file is used by ${usage.length} record${usage.length === 1 ? '' : 's'} (${first}). Remove those references first.`,
      )
    }

    await context.env.DB.prepare('UPDATE media SET deleted_at = datetime(\'now\') WHERE id = ?')
      .bind(id)
      .run()
    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'delete', 'media', id, `Deleted ${row.filename}`)

    return json({ ok: true })
  })
