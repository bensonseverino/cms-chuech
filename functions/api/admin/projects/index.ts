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
import { PROJECT_INPUT_KEYS, PROJECT_LIMITS, slugify } from '@marino/content-schema'
import { actorOf, currentUser } from '../_lib/db'
import { isObject, readJsonBody, run } from '../_lib/http'
import { mediaMapFor } from '../_lib/media'
import {
  categoryRowsForSlugs,
  listCategoryRows,
  listProjects,
  loadProjectView,
  mediaUsageStatements,
  projectImageRefs,
  uniqueSlug,
  validateProjectPayload,
} from '../_lib/projects'
import { reviewIdError } from '../_lib/reviews'

/*
 * GET  /api/admin/projects — list/search/filter case studies
 * POST /api/admin/projects — create a draft
 *
 * Project rows are dense (every section is a column), so create writes the row
 * and then runs the same side-table statements a save does.
 */

const STATUSES = new Set(['draft', 'published'])

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const url = new URL(context.request.url)
    const status = url.searchParams.get('status')?.trim()
    const category = url.searchParams.get('category')?.trim()
    const q = url.searchParams.get('q')?.trim()

    if (status && !STATUSES.has(status)) return error('bad_request', 'Unknown status filter')

    const [items, categories] = await Promise.all([
      listProjects(context.env, {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(q ? { q } : {}),
      }),
      listCategoryRows(context.env),
    ])

    return json({ items, categories, media: await mediaMapFor(context.env, { items }) })
  })

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

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
    const id = newId()

    const reviewError = await reviewIdError(context.env, input.reviewId)
    if (reviewError) return reviewError

    const categories = await categoryRowsForSlugs(context.env, input.categories ?? [])
    if (!categories) {
      return error('unprocessable', 'Some fields need attention', {
        fields: [{ path: 'categories', message: 'Choose from the existing categories' }],
      })
    }

    const maxRow = await context.env.DB.prepare(
      'SELECT COALESCE(MAX(position), -1) AS max_position FROM projects',
    ).first<{ max_position: number }>()

    const slug = await uniqueSlug(
      context.env,
      input.slug || slugify(input.title ?? '') || 'project',
    )
    const position =
      typeof input.position === 'number' ? input.position : (maxRow?.max_position ?? -1) + 1
    const stored = { ...input, slug, position }

    try {
      await context.env.DB.prepare(
        `INSERT INTO projects
           (id, slug, title, client_name, status, is_featured, position,
            card_image, hero_type, hero_image, hero_image_mobile, hero_video_url,
            hero_lead, hero_body, intro_html, feature_heading, feature_text,
            feature_image, gallery, review_id, testimonial_quote, testimonial_author,
            testimonial_company, related_mode, related_ids, seo_title,
            seo_description, og_image, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 datetime('now'), datetime('now'))`,
      )
        .bind(
          id,
          slug,
          stored.title ?? '',
          stored.clientName ?? null,
          stored.isFeatured ? 1 : 0,
          position,
          stored.cardImage ? JSON.stringify(stored.cardImage) : null,
          stored.heroType === 'video' ? 'video' : 'image',
          stored.heroImage ? JSON.stringify(stored.heroImage) : null,
          stored.heroImageMobile ? JSON.stringify(stored.heroImageMobile) : null,
          stored.heroVideoUrl ?? null,
          stored.heroLead ?? null,
          stored.heroBody ?? null,
          stored.introHtml ?? null,
          stored.featureHeading ?? null,
          stored.featureText ?? null,
          stored.featureImage ? JSON.stringify(stored.featureImage) : null,
          JSON.stringify(stored.gallery ?? []),
          stored.reviewId ?? null,
          stored.testimonialQuote ?? null,
          stored.testimonialAuthor ?? null,
          stored.testimonialCompany ?? null,
          stored.relatedMode === 'manual' ? 'manual' : 'auto',
          JSON.stringify((stored.relatedIds ?? []).slice(0, PROJECT_LIMITS.related)),
          stored.seoTitle ?? null,
          stored.seoDescription ?? null,
          stored.ogImage ? JSON.stringify(stored.ogImage) : null,
        )
        .run()
    } catch (cause) {
      console.error('[admin/projects] create failed', cause)
      return error('conflict', 'Could not create that project (the slug may already exist)')
    }

    const statements = [
      ...categories.map((category) =>
        context.env.DB.prepare(
          `INSERT OR IGNORE INTO project_category_map (project_id, category_id) VALUES (?, ?)`,
        ).bind(id, category.id),
      ),
      ...mediaUsageStatements(context.env, id, projectImageRefs(stored)),
    ]
    if (statements.length > 0) await context.env.DB.batch(statements)

    await bumpContentVersion(context.env)
    await audit(context.env, actorOf(user), 'create', 'project', id, `Created project '${slug}'`)

    const view = await loadProjectView(context.env, id)
    return json({ item: view, categories: await listCategoryRows(context.env) }, { status: 201 })
  })
