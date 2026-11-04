import {
  audit,
  bumpContentVersion,
  error,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { videoUrlError } from '@marino/content-schema'
import { actorOf, currentUser } from '../_lib/db'
import { run } from '../_lib/http'
import { mediaMapFor } from '../_lib/media'
import {
  allowedVideoHosts,
  loadProjectView,
  publishBlockers,
  rowToInput,
  categorySlugsByProject,
} from '../_lib/projects'

/*
 * POST /api/admin/projects/:id/publish
 *
 * The checklist the editor disabled its button with is evaluated here again,
 * from the stored row rather than the request body: a stale tab cannot publish
 * a project that has since lost its hero image or its only category.
 */

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const id = String(context.params.id ?? '')
    const view = await loadProjectView(context.env, id)
    if (!view) return error('not_found', 'No such project')

    const slugs = (await categorySlugsByProject(context.env, [id])).get(id) ?? []
    const input = rowToInput(
      {
        id: view.id,
        slug: view.slug ?? '',
        title: view.title ?? '',
        client_name: view.clientName ?? null,
        status: view.status,
        is_featured: view.isFeatured ? 1 : 0,
        position: view.position ?? 0,
        published_at: view.publishedAt,
        card_image: view.cardImage ? JSON.stringify(view.cardImage) : null,
        hero_type: view.heroType ?? 'image',
        hero_image: view.heroImage ? JSON.stringify(view.heroImage) : null,
        hero_image_mobile: view.heroImageMobile ? JSON.stringify(view.heroImageMobile) : null,
        hero_video_url: view.heroVideoUrl ?? null,
        hero_lead: view.heroLead ?? null,
        hero_body: view.heroBody ?? null,
        intro_html: view.introHtml ?? null,
        feature_heading: view.featureHeading ?? null,
        feature_text: view.featureText ?? null,
        feature_image: view.featureImage ? JSON.stringify(view.featureImage) : null,
        gallery: JSON.stringify(view.gallery ?? []),
        testimonial_quote: view.testimonialQuote ?? null,
        testimonial_author: view.testimonialAuthor ?? null,
        testimonial_company: view.testimonialCompany ?? null,
        related_mode: view.relatedMode ?? 'auto',
        related_ids: JSON.stringify(view.relatedIds ?? []),
        seo_title: view.seoTitle ?? null,
        seo_description: view.seoDescription ?? null,
        og_image: view.ogImage ? JSON.stringify(view.ogImage) : null,
        created_at: view.createdAt,
        updated_at: view.updatedAt,
      },
      slugs,
    )

    const blockers = publishBlockers(input, view.categories)
    if (view.heroType === 'video' && view.heroVideoUrl) {
      const message = videoUrlError(view.heroVideoUrl, allowedVideoHosts(context.env))
      if (message) blockers.push({ path: 'heroVideoUrl', message })
    }

    if (blockers.length > 0) {
      return error('unprocessable', 'This project is not ready to publish yet', {
        fields: blockers,
      })
    }

    await context.env.DB.prepare(
      `UPDATE projects SET status = 'published', published_at = datetime('now'),
         updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(id)
      .run()

    await bumpContentVersion(context.env)
    await audit(
      context.env,
      actorOf(user),
      'publish',
      'project',
      id,
      `Published '${view.slug ?? view.id}'`,
    )

    const updated = await loadProjectView(context.env, id)
    return json({ item: updated, media: updated ? await mediaMapFor(context.env, updated) : {} })
  })
