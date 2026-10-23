import {
  audit,
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
 * POST /api/admin/documents/:slug/revert
 *
 * Throw away every un-published edit by copying the last snapshot back into
 * the draft. This does NOT change what the public sees, so it does not bump the
 * content version.
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
    if (row.published_data === null) {
      return error('conflict', 'This document has never been published, so there is nothing to revert to')
    }

    const expectedVersion = await readExpectedVersion(context.request)
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      return error('conflict', 'This document changed in another tab. Reload before reverting.')
    }

    await context.env.DB.prepare(
      `UPDATE documents
          SET data = published_data, version = version + 1,
              updated_at = datetime('now'), updated_by = ?
        WHERE slug = ?`,
    )
      .bind(user.id, slug)
      .run()

    await audit(
      context.env,
      actorOf(user),
      'revert',
      'document',
      slug,
      `Reverted '${row.title}' to its published snapshot`,
    )

    const updated = await loadDocument(context.env, slug)
    if (!updated) return error('server_error', 'The document could not be read back')

    const item = documentView(updated)
    const media = await mediaMapFor(context.env, [item.data, item.publishedData])
    return json({ item, media })
  })
