import type { Env } from './types'

/*
 * Public case-study reads (cms-projects-spec.md §3, §5.1, §5.2, §6).
 *
 * The projects table is written by the admin CMS (functions/api/admin/_lib/
 * projects.ts over there); this module is the read side the live site serves:
 * published cards, one detail with its images resolved to responsive
 * `ImageAsset`s, and the related-projects resolution.
 *
 * `ImageAsset` building is a straight port of `@marino/api-kit`'s
 * (packages/api-kit/src/projects.ts), vendored like `media.ts` so the site repo
 * stays dependency-free. The two must not drift.
 */

// --- Rows (migration 0004) ----------------------------------------------------

export type ProjectRow = {
  id: string
  slug: string
  title: string
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
  gallery: string | null
  testimonial_quote: string | null
  testimonial_author: string | null
  testimonial_company: string | null
  related_mode: string
  related_ids: string
  seo_title: string | null
  seo_description: string | null
  og_image: string | null
  /** forms-reviews spec §9: the review row that replaces the inline columns. */
  review_id: string | null
  created_at: string | null
}

export type ImageRef = {
  mediaId: string
  alt?: string
  focalX?: number
  focalY?: number
}

// --- ImageAsset (vendored from api-kit) ----------------------------------------

export type ImageAsset = {
  url: string
  srcSet: string
  width: number
  height: number
  alt: string
  focalX: number
  focalY: number
}

type MediaVariant = { w: number; key: string }

type ImageMediaRow = {
  id: string
  r2_key: string
  width: number | null
  height: number | null
  alt: string
  variants?: string | null
}

function parseVariants(value: string | null | undefined): MediaVariant[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is MediaVariant =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as MediaVariant).w === 'number' &&
          typeof (item as MediaVariant).key === 'string',
      )
      .map((item) => ({ w: Math.round(item.w), key: item.key }))
      .filter((item) => item.w > 0 && item.key.length > 0)
      .sort((a, b) => a.w - b.w)
  } catch {
    return []
  }
}

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, Math.round(value)))
}

function mediaPublicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`
}

/**
 * The public asset shape for one image slot (cms-projects-spec.md §6):
 * `srcSet` from the stored WebP variants, `width`/`height` of the URL actually
 * used (so the frontend can emit dimensions and nothing shifts), focal point
 * for `object-position`.
 */
export function buildImageAsset(
  base: string,
  row: ImageMediaRow,
  ref: ImageRef | null | undefined,
): ImageAsset {
  const variants = parseVariants(row.variants)
  const largest = variants.length > 0 ? variants[variants.length - 1] : undefined

  const url = mediaPublicUrl(base, largest?.key ?? row.r2_key)
  const width = largest?.w ?? row.width ?? 0
  const height =
    row.width && row.height && width > 0
      ? Math.round((row.height / row.width) * width)
      : (row.height ?? 0)

  const srcSet =
    variants.length > 0
      ? variants.map((variant) => `${mediaPublicUrl(base, variant.key)} ${variant.w}w`).join(', ')
      : row.width
        ? `${url} ${row.width}w`
        : ''

  return {
    url,
    srcSet,
    width,
    height,
    alt: (ref?.alt ?? row.alt ?? '').trim(),
    focalX: clampPercent(ref?.focalX),
    focalY: clampPercent(ref?.focalY),
  }
}

// --- JSON columns ----------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((item) => (isPlainObject(item) ? parseImageRef(JSON.stringify(item)) : null))
    .filter((item): item is ImageRef => item !== null)
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

// --- Media resolution -------------------------------------------------------------

const MEDIA_COLUMNS = 'id, r2_key, width, height, alt, variants'

async function mediaRowsById(env: Env, ids: readonly string[]): Promise<Map<string, ImageMediaRow>> {
  const unique = [...new Set(ids)].filter(Boolean)
  const map = new Map<string, ImageMediaRow>()
  if (unique.length === 0) return map

  const placeholders = unique.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT ${MEDIA_COLUMNS} FROM media WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  )
    .bind(...unique)
    .all<ImageMediaRow>()

  for (const row of results ?? []) map.set(row.id, row)
  return map
}

/**
 * Resolve every ImageRef in one batch. An unknown/deleted id drops out of the
 * result (the slot then renders nothing) — a page never fails on one image.
 */
async function resolveRefs(
  env: Env,
  refs: readonly (ImageRef | null | undefined)[],
): Promise<(ImageAsset | null)[]> {
  const rows = await mediaRowsById(
    env,
    refs.filter((ref): ref is ImageRef => ref !== null && ref !== undefined).map((ref) => ref.mediaId),
  )
  const base = env.MEDIA_PUBLIC_BASE
  return refs.map((ref) => {
    if (!ref) return null
    const row = rows.get(ref.mediaId)
    return row ? buildImageAsset(base, row, ref) : null
  })
}

// --- Categories -------------------------------------------------------------------

export type CategoryRow = { slug: string; label: string; position: number }

export async function listCategories(env: Env): Promise<CategoryRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT slug, label, position FROM project_categories ORDER BY position ASC, label ASC',
  ).all<CategoryRow>()
  return results ?? []
}

/** Category slugs for many projects, in one query, in editorial order. */
async function categoriesByProject(
  env: Env,
  projectIds: readonly string[],
): Promise<Map<string, { slug: string; label: string }[]>> {
  const map = new Map<string, { slug: string; label: string }[]>()
  if (projectIds.length === 0) return map

  const placeholders = projectIds.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT m.project_id, c.slug, c.label
       FROM project_category_map m
       JOIN project_categories c ON c.id = m.category_id
      WHERE m.project_id IN (${placeholders})
      ORDER BY c.position ASC, c.label ASC`,
  )
    .bind(...projectIds)
    .all<{ project_id: string; slug: string; label: string }>()

  for (const row of results ?? []) {
    const list = map.get(row.project_id) ?? []
    list.push({ slug: row.slug, label: row.label })
    map.set(row.project_id, list)
  }
  return map
}

// --- Cards --------------------------------------------------------------------------

export type ProjectCard = {
  id: string
  slug: string
  title: string
  image: ImageAsset
  categories: { slug: string; label: string }[]
}

/**
 * Build the card shape for rows that already carry categories. The card image
 * falls back to the hero image (cms-projects-spec.md §3); a project with
 * neither (or deleted media) is skipped — never an empty card on the grid.
 */
async function cardsForRows(
  env: Env,
  rows: readonly ProjectRow[],
  categories: Map<string, { slug: string; label: string }[]>,
): Promise<ProjectCard[]> {
  const refs = rows.map((row) => parseImageRef(row.card_image) ?? parseImageRef(row.hero_image))
  const assets = await resolveRefs(env, refs)

  const cards: ProjectCard[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const image = assets[index]
    if (!row || !image) continue
    cards.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      image,
      categories: categories.get(row.id) ?? [],
    })
  }
  return cards
}

// --- List ---------------------------------------------------------------------------

export type ListOptions = {
  category?: string
  featured?: boolean
  limit: number
  offset: number
}

export type ListResult = { cards: ProjectCard[]; nextCursor: number | null; total: number }

const LIST_COLUMNS = [
  'id',
  'slug',
  'title',
  'status',
  'is_featured',
  'position',
  'published_at',
  'card_image',
  'hero_image',
].join(', ')

/** Published cards, ordered by position then newest (cms-projects-spec.md §5.1). */
export async function listPublishedCards(env: Env, options: ListOptions): Promise<ListResult> {
  const conditions = ["p.status = 'published'"]
  const bindings: unknown[] = []

  if (options.category) {
    conditions.push(
      `EXISTS (SELECT 1 FROM project_category_map m
                 JOIN project_categories c ON c.id = m.category_id
                WHERE m.project_id = p.id AND c.slug = ?)`,
    )
    bindings.push(options.category)
  }
  if (options.featured) {
    conditions.push('p.is_featured = 1')
  }

  const where = `WHERE ${conditions.join(' AND ')}`

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM projects p ${where}`)
    .bind(...bindings)
    .first<{ count: number }>()
  const total = countRow?.count ?? 0

  const { results } = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM projects p
      ${where}
     ORDER BY p.position ASC, p.published_at DESC, p.id ASC
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, options.limit, options.offset)
    .all<ProjectRow>()

  const rows = results ?? []
  const categories = await categoriesByProject(env, rows.map((row) => row.id))
  const cards = await cardsForRows(env, rows, categories)

  const nextOffset = options.offset + rows.length
  return {
    cards,
    nextCursor: rows.length < options.limit || nextOffset >= total ? null : nextOffset,
    total,
  }
}

// --- Detail --------------------------------------------------------------------------

export type ProjectDetail = ProjectCard & {
  hero: {
    type: 'image' | 'video'
    image: ImageAsset
    imageMobile?: ImageAsset
    videoUrl?: string
    lead: string
    body?: string
  }
  introHtml?: string
  feature?: { heading: string; text: string; image?: ImageAsset }
  gallery: ImageAsset[]
  testimonial?: { quote: string; author: string; company: string }
  related: ProjectCard[]
  seo: { title: string; description: string; ogImage?: ImageAsset }
  publishedAt: string
}

async function loadRow(env: Env, slug: string): Promise<ProjectRow | null> {
  return env.DB.prepare(`SELECT * FROM projects WHERE slug = ?`).bind(slug).first<ProjectRow>()
}

async function loadRowById(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(id).first<ProjectRow>()
}

/** Old URLs keep working after a rename (cms-projects-spec.md §3). */
export async function slugRedirect(env: Env, slug: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT project_id FROM project_slug_history WHERE slug = ?',
  )
    .bind(slug)
    .first<{ project_id: string }>()
  if (!row) return null
  const project = await loadRowById(env, row.project_id)
  return project ? `/work/${project.slug}` : null
}

/**
 * Related projects (cms-projects-spec.md §5.2): manual mode takes the chosen
 * published projects in the chosen order; auto mode takes other published
 * projects sharing the most categories, newest first, max 8.
 */
async function resolveRelated(env: Env, row: ProjectRow): Promise<ProjectCard[]> {
  const relatedIds = parseStringArray(row.related_ids).filter((id) => id !== row.id)

  let rows: ProjectRow[] = []
  if (row.related_mode === 'manual' && relatedIds.length > 0) {
    const placeholders = relatedIds.map(() => '?').join(',')
    const { results } = await env.DB.prepare(
      `SELECT * FROM projects
        WHERE status = 'published' AND id IN (${placeholders})`,
    )
      .bind(...relatedIds)
      .all<ProjectRow>()
    const byId = new Map((results ?? []).map((item) => [item.id, item]))
    rows = relatedIds.map((id) => byId.get(id)).filter((item): item is ProjectRow => item !== undefined)
  } else if (row.related_mode !== 'manual') {
    // Shared-category ranking, computed in SQL-adjacent JS: the projects table
    // is small (dozens of rows), the map query is one round trip.
    const [mine, others] = await Promise.all([
      categoriesByProject(env, [row.id]),
      env.DB.prepare(
        `SELECT * FROM projects
          WHERE status = 'published' AND id != ?
          ORDER BY position ASC, published_at DESC, id ASC
          LIMIT 100`,
      )
        .bind(row.id)
        .all<ProjectRow>(),
    ])

    const shared = new Set((mine.get(row.id) ?? []).map((category) => category.slug))
    const othersCategories = await categoriesByProject(env, (others.results ?? []).map((item) => item.id))

    rows = (others.results ?? [])
      .map((item) => ({
        row: item,
        score: (othersCategories.get(item.id) ?? []).filter((category) => shared.has(category.slug)).length,
      }))
      .sort((a, b) => b.score - a.score || a.row.position - b.row.position)
      .slice(0, 8)
      .map((item) => item.row)
  }

  if (rows.length === 0) return []
  const categories = await categoriesByProject(env, rows.map((item) => item.id))
  return cardsForRows(env, rows, categories)
}

/**
 * The full detail payload for one published project (or a draft when a valid
 * preview token says so). Unknown images resolve to nothing; empty optional
 * sections are simply absent so the frontend can skip them (§2 empty-section
 * rule).
 */
export async function getProjectDetail(env: Env, row: ProjectRow): Promise<ProjectDetail | null> {
  const [heroRef, heroMobileRef, featureRef, ogRef] = [
    parseImageRef(row.hero_image),
    parseImageRef(row.hero_image_mobile),
    parseImageRef(row.feature_image),
    parseImageRef(row.og_image),
  ]
  const galleryRefs = parseImageRefs(row.gallery)

  const [image, imageMobile, featureImage, ogImage, gallery] = await Promise.all([
    resolveRefs(env, [heroRef]).then(([asset]) => asset),
    resolveRefs(env, [heroMobileRef]).then(([asset]) => asset),
    resolveRefs(env, [featureRef]).then(([asset]) => asset),
    resolveRefs(env, [ogRef]).then(([asset]) => asset),
    resolveRefs(env, galleryRefs).then((assets) => assets.filter((asset): asset is ImageAsset => asset !== null)),
  ])

  const categories = (await categoriesByProject(env, [row.id])).get(row.id) ?? []

  const detail: ProjectDetail = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    image: image ?? {
      url: '',
      srcSet: '',
      width: 0,
      height: 0,
      alt: '',
      focalX: 50,
      focalY: 50,
    },
    categories,
    hero: {
      type: row.hero_type === 'video' && row.hero_video_url ? 'video' : 'image',
      image: image ?? { url: '', srcSet: '', width: 0, height: 0, alt: '', focalX: 50, focalY: 50 },
      lead: row.hero_lead ?? row.title,
    },
    gallery,
    related: await resolveRelated(env, row),
    seo: {
      title: row.seo_title ?? row.title,
      description: row.seo_description ?? row.hero_lead ?? row.title,
      ...(ogImage ? { ogImage } : image ? { ogImage: image } : {}),
    },
    publishedAt: row.published_at ?? row.created_at ?? new Date().toISOString(),
  }

  if (imageMobile) detail.hero.imageMobile = imageMobile
  if (row.hero_type === 'video' && row.hero_video_url) detail.hero.videoUrl = row.hero_video_url
  if (row.hero_body) detail.hero.body = row.hero_body
  if (row.intro_html) detail.introHtml = row.intro_html
  if (row.feature_heading || row.feature_text) {
    detail.feature = {
      heading: row.feature_heading ?? '',
      text: row.feature_text ?? '',
      ...(featureImage ? { image: featureImage } : {}),
    }
  }
  // Testimonial (forms-reviews spec §9): the linked review row wins; the inline
  // columns are the fallback so pre-migration rows keep rendering.
  const linkedReview = await reviewById(env, row.review_id)
  if (linkedReview) {
    detail.testimonial = {
      quote: linkedReview.quote,
      author: linkedReview.authorName,
      company: linkedReview.company ?? row.title,
    }
  } else if (row.testimonial_quote) {
    detail.testimonial = {
      quote: row.testimonial_quote,
      author: row.testimonial_author ?? '',
      company: row.testimonial_company ?? row.title,
    }
  }

  return detail
}

/**
 * The linked review (forms-reviews spec §9), when it exists and is visible.
 * Inline testimonial columns stay the fallback for one release.
 */
export async function reviewById(
  env: Env,
  id: string | null | undefined,
): Promise<{ quote: string; authorName: string; company: string | null } | null> {
  if (!id) return null
  const row = await env.DB.prepare(
    `SELECT quote, author_name, company FROM reviews WHERE id = ? AND is_visible = 1`,
  )
    .bind(id)
    .first<{ quote: string; author_name: string; company: string | null }>()
  if (!row) return null
  return { quote: row.quote, authorName: row.author_name, company: row.company }
}

/** Detail by slug; drafts only when `includeDrafts` (preview path). */
export async function findDetail(
  env: Env,
  slug: string,
  includeDrafts = false,
): Promise<ProjectDetail | null> {
  const row = await loadRow(env, slug)
  if (!row) return null
  if (row.status !== 'published' && !includeDrafts) return null
  return getProjectDetail(env, row)
}
