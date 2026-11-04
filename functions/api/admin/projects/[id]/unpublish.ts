import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../../_lib/db'
import { run } from '../../_lib/http'
import { mediaMapFor } from '../../_lib/media'
import { loadProjectView } from '../../_lib/projects'

/* POST /api/admin/projects/:id/unpublish — back to draft; the page 404s. */

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const view = await loadProjectView(context.env, id)
    if (!view) return error('not_found', 'No such project')

    await context.env.DB.prepare(
      `UPDATE projects SET status = 'draft', published_at = NULL, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(id)
      .run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'unpublish',
      'project',
      id,
      `Unpublished '${view.slug ?? view.id}'`,
    )

    const updated = await loadProjectView(context.env, id)
    return json({ item: updated, media: updated ? await mediaMapFor(context.env, updated) : {} })
  })
