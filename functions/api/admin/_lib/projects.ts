import {
  PROJECT_LIMITS,
  projectPublishChecklist,
  projectPublishErrors,
  projectSchema,
  sanitizeIntroHtml,
  videoUrlError,
  type ImageRef,
  type ProjectInput,
  type PublishChecklistItem,
} from '@marino/content-schema'
import { collectImageRefs, type Env } from '@marino/api-kit'

/*
 * Admin data access for case studies.
 *
 * Projects are their own table (not entries): the page has eight sections, an
 * ordered gallery, categories and related-project selection. This module is the
 * single place that knows the row shape, the JSON columns and the two side
 * tables that must stay in step with a save (`project_category_map` and
 * `media_usage`).
 */

// --- Rows --------------------------------------------------------------------

export const PROJECT_COLUMNS = [
  'id',
  'slug',
  'title',
  'client_name',
  'status',
  'is_featured',
  'position',
  'published_at',
  'card_image',
  'hero_type',
  'hero_image',
  'hero_image_mobile',
  'hero_video_url',
  'hero_lead',
  'hero_body',
  'intro_html',
  'feature_heading',
  'feature_text',
  'feature_image',
  'gallery',
  'review_id',
  'testimonial_quote',
  'testimonial_author',
  'testimonial_company',
  'related_mode',
  'related_ids',
  'seo_title',
  'seo_description',
  'og_image',
  'created_at',
  'updated_at',
].join(', ')

export type ProjectRow = {
  id: string
  slug: string
  title: string
  client_name: string | null
  status: string
  is_featured: number
  position: number
  published_at: string | null
  card_image: string | null
  hero_type: string
  hero_image: string | null
  hero_image_mobile: string | null
  hero_video_url: string | null
  hero_lead: string | null
  hero_body: string | null
  intro_html: string | null
  feature_heading: string | null
  feature_text: string | null
  feature_image: string | null
  gallery: string
  review_id: string | null
  testimonial_quote: string | null
  testimonial_author: string | null
  testimonial_company: string | null
  related_mode: string
  related_ids: string
  seo_title: string | null
  seo_description: string | null
  og_image: string | null
  created_at: string
  updated_at: string
}

export type CategoryRow = {
  id: string
  slug: string
  label: string
  position: number
  created_at: string
  updated_at: string
}

export type CategoryView = {
  id: string
  slug: string
  label: string
  position: number
  /** How many projects (any status) use it — blocks deletion. */
  projectCount?: number
}

export type ProjectView = Omit<ProjectInput, 'categories'> & {
  id: string
  status: string
  publishedAt: string | null
  categories: CategoryView[]
  checklist: PublishChecklistItem[]
  createdAt: string
  updatedAt: string
}

// --- JSON helpers ------------------------------------------------------------

export function parseObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseArray(value: string | null | undefined): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normalise a stored ImageRef: media id must survive, focal defaults to centre. */
export function parseImageRef(value: string | null | undefined): ImageRef | null {
  if (!value) return null
  let raw: unknown
  try {
    raw = JSON.parse(value) as unknown
  } catch {
    return null
  }
  if (!isPlainObject(raw) || typeof raw.mediaId !== 'string') return null

  return {
    mediaId: raw.mediaId,
    ...(typeof raw.alt === 'string' && raw.alt.length > 0 ? { alt: raw.alt } : {}),
    ...(typeof raw.focalX === 'number' ? { focalX: clampPercent(raw.focalX) } : {}),
    ...(typeof raw.focalY === 'number' ? { focalY: clampPercent(raw.focalY) } : {}),
  }
}

export function parseImageRefs(value: string | null | undefined): ImageRef[] {
  return parseArray(value)
    .map((item) => parseImageRef(JSON.stringify(item)))
    .filter((item): item is ImageRef => item !== null)
}

export function parseStringArray(value: string | null | undefined): string[] {
  return parseArray(value).filter((item): item is string => typeof item === 'string')
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** Stored JSON for an ImageRef column (null when the slot is empty). */
export function imageColumn(ref: ImageRef | undefined | null): string | null {
  if (!ref?.mediaId) return null
  return JSON.stringify({
    mediaId: ref.mediaId,
    ...(ref.alt ? { alt: ref.alt } : {}),
    focalX: ref.focalX ?? 50,
    focalY: ref.focalY ?? 50,
  })
}

// --- Row ↔ input -------------------------------------------------------------

export function rowToInput(row: ProjectRow, categorySlugs: string[] = []): ProjectInput {
  const input: ProjectInput = {
    title: row.title,
    slug: row.slug,
    categories: categorySlugs,
    isFeatured: row.is_featured === 1,
    position: row.position,
    heroType: row.hero_type === 'video' ? 'video' : 'image',
    gallery: parseImageRefs(row.gallery),
    relatedMode: row.related_mode === 'manual' ? 'manual' : 'auto',
    relatedIds: parseStringArray(row.related_ids),
  }

  if (row.client_name) input.clientName = row.client_name
  const card = parseImageRef(row.card_image)
  if (card) input.cardImage = card
  const hero = parseImageRef(row.hero_image)
  if (hero) input.heroImage = hero
  const heroMobile = parseImageRef(row.hero_image_mobile)
  if (heroMobile) input.heroImageMobile = heroMobile
  if (row.hero_video_url) input.heroVideoUrl = row.hero_video_url
  if (row.hero_lead) input.heroLead = row.hero_lead
  if (row.hero_body) input.heroBody = row.hero_body
  if (row.intro_html) input.introHtml = row.intro_html
  if (row.feature_heading) input.featureHeading = row.feature_heading
  if (row.feature_text) input.featureText = row.feature_text
  const featureImage = parseImageRef(row.feature_image)
  if (featureImage) input.featureImage = featureImage
  if (row.testimonial_quote) input.testimonialQuote = row.testimonial_quote
  if (row.testimonial_author) input.testimonialAuthor = row.testimonial_author
  if (row.testimonial_company) input.testimonialCompany = row.testimonial_company
  input.reviewId = row.review_id
  if (row.seo_title) input.seoTitle = row.seo_title
  if (row.seo_description) input.seoDescription = row.seo_description
  const og = parseImageRef(row.og_image)
  if (og) input.ogImage = og

  return input
}

// --- Reads -------------------------------------------------------------------

export async function loadProjectRow(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`)
    .bind(id)
    .first<ProjectRow>()
}

export async function listCategoryRows(env: Env): Promise<CategoryRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, label, position, created_at, updated_at
       FROM project_categories ORDER BY position ASC, label ASC`,
  ).all<CategoryRow>()
  return results ?? []
}

/** Category slugs for many projects, in one query. */
export async function categorySlugsByProject(
  env: Env,
  projectIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (projectIds.length === 0) return map

  const placeholders = projectIds.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT m.project_id, c.slug
       FROM project_category_map m
       JOIN project_categories c ON c.id = m.category_id
      WHERE m.project_id IN (${placeholders})
      ORDER BY c.position ASC, c.label ASC`,
  )
    .bind(...projectIds)
    .all<{ project_id: string; slug: string }>()

  for (const row of results ?? []) {
    const list = map.get(row.project_id) ?? []
    list.push(row.slug)
    map.set(row.project_id, list)
  }
  return map
}

export async function listProjects(
  env: Env,
  filters: { q?: string; status?: string; category?: string } = {},
): Promise<ProjectView[]> {
  const conditions: string[] = []
  const bindings: unknown[] = []

  if (filters.status) {
    conditions.push('p.status = ?')
    bindings.push(filters.status)
  }
  if (filters.q) {
    conditions.push('(p.title LIKE ? OR p.slug LIKE ? OR p.client_name LIKE ?)')
    const like = `%${filters.q}%`
    bindings.push(like, like, like)
  }
  if (filters.category) {
    conditions.push(
      `EXISTS (SELECT 1 FROM project_category_map m
                 JOIN project_categories c ON c.id = m.category_id
                WHERE m.project_id = p.id AND c.slug = ?)`,
    )
    bindings.push(filters.category)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const columns = PROJECT_COLUMNS.split(', ')
    .map((column) => `p.${column}`)
    .join(', ')

  const { results } = await env.DB.prepare(
    `SELECT ${columns} FROM projects p
       ${where}
      ORDER BY p.position ASC, p.published_at DESC, p.title ASC`,
  )
    .bind(...bindings)
    .all<ProjectRow>()

  return projectViews(env, results ?? [])
}

export async function projectViews(
  env: Env,
  rows: readonly ProjectRow[],
): Promise<ProjectView[]> {
  if (rows.length === 0) return []

  const [categories, slugMap] = await Promise.all([
    listCategoryRows(env),
    categorySlugsByProject(
      env,
      rows.map((row) => row.id),
    ),
  ])

  const bySlug = new Map(categories.map((category) => [category.slug, category]))

  return rows.map((row) => {
    const slugs = slugMap.get(row.id) ?? []
    const selected: CategoryView[] = []
    for (const slug of slugs) {
      const category = bySlug.get(slug)
      if (category) {
        selected.push({
          id: category.id,
          slug: category.slug,
          label: category.label,
          position: category.position,
        })
      }
    }

    const input = rowToInput(row, slugs)
    return {
      ...input,
      id: row.id,
      status: row.status,
      publishedAt: row.published_at,
      categories: selected,
      checklist: projectPublishChecklist(input),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })
}

export async function loadProjectView(env: Env, id: string): Promise<ProjectView | null> {
  const row = await loadProjectRow(env, id)
  if (!row) return null
  const views = await projectViews(env, [row])
  return views[0] ?? null
}

// --- Validation --------------------------------------------------------------

export type ValidationOutcome =
  | { ok: true; input: ProjectInput }
  | { ok: false; fields: { path: string; message: string }[] }

/**
 * Validate a draft-level payload, sanitise the intro HTML and enforce the
 * video-host rule. Drafts stay permissive; publish requirements are separate.
 */
export function validateProjectPayload(raw: unknown, env: Env): ValidationOutcome {
  const parsed = projectSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      fields: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || 'form',
        message: issue.message,
      })),
    }
  }

  const input: ProjectInput = {
    ...parsed.data,
    ...(typeof parsed.data.introHtml === 'string'
      ? { introHtml: sanitizeIntroHtml(parsed.data.introHtml) }
      : {}),
  }

  if (input.heroType === 'video' && input.heroVideoUrl) {
    const message = videoUrlError(input.heroVideoUrl, allowedVideoHosts(env))
    if (message) return { ok: false, fields: [{ path: 'heroVideoUrl', message }] }
  }

  return { ok: true, input }
}

export function allowedVideoHosts(env: Env): string[] {
  return (env.ALLOWED_VIDEO_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

/** The publish gate, including the "category must still exist" rule. */
export function publishBlockers(
  input: ProjectInput,
  categories: readonly CategoryView[],
): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = projectPublishErrors(input).map((error) => ({
    path: error.path,
    message: error.message,
  }))

  if ((input.categories ?? []).length > 0) {
    const known = new Set(categories.map((category) => category.slug))
    const unknown = (input.categories ?? []).filter((slug) => !known.has(slug))
    if (unknown.length > 0) {
      errors.push({ path: 'categories', message: `Unknown category: ${unknown.join(', ')}` })
    }
  }

  return errors
}

export function publishBlockerItems(input: ProjectInput, categories: readonly CategoryView[]) {
  const blockers = new Set(publishBlockers(input, categories).map((error) => error.path))
  return projectPublishChecklist(input).map((item) => ({
    ...item,
    ok: item.ok && !blockers.has(item.key) && !blockers.has(item.key.replace('Alt', '.alt')),
  }))
}

// --- Writes ------------------------------------------------------------------

/** Resolve category slugs to rows; returns null when one is unknown. */
export async function categoryRowsForSlugs(
  env: Env,
  slugs: readonly string[],
): Promise<CategoryRow[] | null> {
  const unique = [...new Set(slugs)]
  if (unique.length === 0) return []

  const placeholders = unique.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT id, slug, label, position, created_at, updated_at
       FROM project_categories WHERE slug IN (${placeholders})`,
  )
    .bind(...unique)
    .all<CategoryRow>()

  const rows = results ?? []
  if (rows.length !== unique.length) return null
  return rows
}

/** Every ImageRef in a project, for `media_usage`. */
export function projectImageRefs(input: ProjectInput): ImageRef[] {
  return collectImageRefs({
    cardImage: input.cardImage,
    heroImage: input.heroImage,
    heroImageMobile: input.heroImageMobile,
    featureImage: input.featureImage,
    gallery: input.gallery ?? [],
    ogImage: input.ogImage,
  })
}

export function imageRefsColumn(refs: readonly ImageRef[] | undefined): string {
  return JSON.stringify(
    (refs ?? []).map((ref) => ({
      mediaId: ref.mediaId,
      ...(ref.alt ? { alt: ref.alt } : {}),
      focalX: ref.focalX ?? 50,
      focalY: ref.focalY ?? 50,
    })),
  )
}

export function mediaUsageStatements(env: Env, entityId: string, refs: readonly ImageRef[]) {
  const unique = [...new Set(refs.map((ref) => ref.mediaId).filter(Boolean))]
  const statements = [
    env.DB.prepare(`DELETE FROM media_usage WHERE entity = 'project' AND entity_id = ?`).bind(
      entityId,
    ),
  ]
  for (const mediaId of unique) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO media_usage (media_id, entity, entity_id)
         VALUES (?, 'project', ?)`,
      ).bind(mediaId, entityId),
    )
  }
  return statements
}

/**
 * The statements a save runs as one transaction: slug history, category map,
 * media usage and the project row itself.
 */
export function projectSaveStatements(
  env: Env,
  options: {
    id: string
    currentSlug: string
    input: ProjectInput
    categories: readonly CategoryRow[]
  },
) {
  const { id, input, categories } = options
  const slug = input.slug ?? options.currentSlug
  const statements = []

  if (options.currentSlug !== slug) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO project_slug_history (slug, project_id, created_at)
         VALUES (?, ?, datetime('now'))`,
      ).bind(options.currentSlug, id),
    )
    // A re-used slug must stop redirecting to this project.
    statements.push(env.DB.prepare('DELETE FROM project_slug_history WHERE slug = ?').bind(slug))
  }

  statements.push(env.DB.prepare(`DELETE FROM project_category_map WHERE project_id = ?`).bind(id))
  for (const category of categories) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO project_category_map (project_id, category_id) VALUES (?, ?)`,
      ).bind(id, category.id),
    )
  }

  statements.push(...mediaUsageStatements(env, id, projectImageRefs(input)))

  statements.push(
    env.DB.prepare(
      `UPDATE projects SET
         slug = ?, title = ?, client_name = ?, is_featured = ?,
         position = COALESCE(?, position),
         card_image = ?, hero_type = ?, hero_image = ?, hero_image_mobile = ?,
         hero_video_url = ?, hero_lead = ?, hero_body = ?, intro_html = ?,
         feature_heading = ?, feature_text = ?, feature_image = ?, gallery = ?,
         review_id = ?, testimonial_quote = ?, testimonial_author = ?, testimonial_company = ?,
         related_mode = ?, related_ids = ?, seo_title = ?, seo_description = ?,
         og_image = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      slug,
      input.title ?? '',
      input.clientName ?? null,
      input.isFeatured ? 1 : 0,
      typeof input.position === 'number' ? input.position : null,
      imageColumn(input.cardImage),
      input.heroType === 'video' ? 'video' : 'image',
      imageColumn(input.heroImage),
      imageColumn(input.heroImageMobile),
      input.heroVideoUrl ?? null,
      input.heroLead ?? null,
      input.heroBody ?? null,
      input.introHtml ?? null,
      input.featureHeading ?? null,
      input.featureText ?? null,
      imageColumn(input.featureImage),
      imageRefsColumn(input.gallery),
      input.reviewId ?? null,
      input.testimonialQuote ?? null,
      input.testimonialAuthor ?? null,
      input.testimonialCompany ?? null,
      input.relatedMode === 'manual' ? 'manual' : 'auto',
      JSON.stringify((input.relatedIds ?? []).slice(0, PROJECT_LIMITS.related)),
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      imageColumn(input.ogImage),
      id,
    ),
  )

  return statements
}

/** A unique slug for a copy or a slug-less draft. */
export async function uniqueSlug(
  env: Env,
  desired: string,
  excludeId?: string,
): Promise<string> {
  const base = desired || 'project'
  let candidate = base
  let counter = 1

  // Bounded: at most 50 attempts, then a timestamp suffix.
  while (counter <= 50) {
    const row = await env.DB.prepare(
      `SELECT id FROM projects WHERE slug = ? ${excludeId ? 'AND id != ?' : ''}`,
    )
      .bind(...(excludeId ? [candidate, excludeId] : [candidate]))
      .first<{ id: string }>()

    if (!row) {
      const history = await env.DB.prepare(
        'SELECT slug FROM project_slug_history WHERE slug = ?',
      )
        .bind(candidate)
        .first<{ slug: string }>()
      if (!history) return candidate
    }

    counter += 1
    candidate = `${base}-${counter}`
  }

  return `${base}-${Date.now().toString(36)}`
}
