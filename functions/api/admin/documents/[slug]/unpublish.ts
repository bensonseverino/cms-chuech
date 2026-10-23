import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser, documentView, isSettingsDocument, loadDocument } from '../../_lib/db'
import { mediaMapFor } from '../../_lib/media'
import { readExpectedVersion, run } from '../../_lib/http'

/*
 * POST /api/admin/documents/:slug/unpublish
 *
 * The public API requires BOTH `status = 'published'` and a snapshot, so a
 * status change is enough to take a page down. The snapshot is kept so the
 * editor can still diff and re-publish without losing the live copy.
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
      return error('conflict', 'This document changed in another tab. Reload before unpublishing.')
    }

    await context.env.DB.prepare(
      `UPDATE documents
          SET status = 'draft', version = version + 1,
              updated_at = datetime('now'), updated_by = ?
        WHERE slug = ?`,
    )
      .bind(user.id, slug)
      .run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'unpublish',
      'document',
      slug,
      `Unpublished '${row.title}'`,
    )

    const updated = await loadDocument(context.env, slug)
    if (!updated) return error('server_error', 'The document could not be read back')

    const item = documentView(updated)
    const media = await mediaMapFor(context.env, [item.data, item.publishedData])
    return json({ item, media })
  })
