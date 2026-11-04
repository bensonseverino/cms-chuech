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
import { actorOf, currentUser } from '../../_lib/db'
import { run } from '../../_lib/http'
import { mediaMapFor } from '../../_lib/media'
import {
  loadProjectRow,
  loadProjectView,
  mediaUsageStatements,
  projectImageRefs,
  rowToInput,
  uniqueSlug,
  categorySlugsByProject,
} from '../../_lib/projects'

/*
 * POST /api/admin/projects/:id/duplicate
 *
 * A copy is an independent draft: new id, fresh unique slug, " (copy)" title,
 * its own category map and its own media_usage rows. The original is untouched.
 */

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const row = await loadProjectRow(context.env, id)
    if (!row) return error('not_found', 'No such project')

    const newProjectId = newId()
    const slug = await uniqueSlug(context.env, `${row.slug}-copy`)
    const maxRow = await context.env.DB.prepare(
      'SELECT COALESCE(MAX(position), -1) AS max_position FROM projects',
    ).first<{ max_position: number }>()

    await context.env.DB.prepare(
      `INSERT INTO projects
         (id, slug, title, client_name, status, is_featured, position, published_at,
          card_image, hero_type, hero_image, hero_image_mobile, hero_video_url,
          hero_lead, hero_body, intro_html, feature_heading, feature_text, feature_image,
          gallery, testimonial_quote, testimonial_author, testimonial_company,
          related_mode, related_ids, seo_title, seo_description, og_image,
          created_at, updated_at)
       SELECT ?, ?, ?, client_name, 'draft', 0, ?, NULL,
              card_image, hero_type, hero_image, hero_image_mobile, hero_video_url,
              hero_lead, hero_body, intro_html, feature_heading, feature_text, feature_image,
              gallery, testimonial_quote, testimonial_author, testimonial_company,
              related_mode, related_ids, seo_title, seo_description, og_image,
              datetime('now'), datetime('now')
         FROM projects WHERE id = ?`,
    )
      .bind(newProjectId, slug, `${row.title} (copy)`, (maxRow?.max_position ?? -1) + 1, id)
      .run()

    const categories = (await categorySlugsByProject(context.env, [id])).get(id) ?? []
    const input = rowToInput(row, categories)

    const statements = [
      context.env.DB.prepare(
        `INSERT OR IGNORE INTO project_category_map (project_id, category_id)
         SELECT ?, category_id FROM project_category_map WHERE project_id = ?`,
      ).bind(newProjectId, id),
      ...mediaUsageStatements(context.env, newProjectId, projectImageRefs(input)),
    ]
    await context.env.DB.batch(statements)

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'create',
      'project',
      newProjectId,
      `Duplicated '${row.slug}' as '${slug}'`,
    )

    const view = await loadProjectView(context.env, newProjectId)
    if (!view) return error('server_error', 'The copy could not be read back')
    return json({ item: view, media: await mediaMapFor(context.env, view) }, { status: 201 })
  })
