import { z } from 'zod'
import { inlineText, slug as slugSchema } from './primitives'
import { draftObject } from './shape'
import type { FieldError } from './validate'

/*
 * A case study (cms-projects-spec.md §2–§3).
 *
 * This schema is separate from the legacy `entries` projects collection on
 * purpose: the page has eight sections the generic entry shape cannot express
 * (hero lead/body, highlighted intro HTML, feature block, testimonial, related
 * selection, per-project SEO). Drafts may be incomplete; the publish gate below
 * is the only place requirements are enforced.
 */

// --- Limits (§3) -------------------------------------------------------------

export const PROJECT_LIMITS = {
  title: 120,
  slug: 80,
  heroLead: 200,
  heroBody: 600,
  introHtml: 1200,
  featureHeading: 80,
  featureText: 800,
  gallery: 24,
  testimonialQuote: 800,
  categories: 6,
  related: 12,
  seoTitle: 70,
  seoDescription: 160,
  alt: 300,
  clientName: 120,
  categorySlug: 40,
  categoryLabel: 40,
  videoUrl: 2048,
} as const

// --- Image references --------------------------------------------------------

/**
 * An image slot: a media-library reference plus the alt text and crop focus
 * that apply *in this slot*. `focalX/focalY` are 0–100 (CSS percentages); a
 * missing value means centred.
 */
export const imageRefSchema = z.object({
  mediaId: z.string().regex(/^med_[0-9A-Z]{26}$/, 'Not a media id'),
  alt: inlineText(PROJECT_LIMITS.alt).optional(),
  focalX: z.number().min(0).max(100).optional(),
  focalY: z.number().min(0).max(100).optional(),
})

export type ImageRef = z.infer<typeof imageRefSchema>

/** Focal point as a CSS `object-position` pair, defaulting to centre. */
export function focalPosition(ref: ImageRef | undefined | null): string {
  const x = ref?.focalX ?? 50
  const y = ref?.focalY ?? 50
  return `${clampPercent(x)}% ${clampPercent(y)}%`
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, Math.round(value)))
}

// --- Project -----------------------------------------------------------------

export const projectCategorySlug = z
  .string()
  .min(1)
  .max(PROJECT_LIMITS.categorySlug)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

export const projectSchema = draftObject({
  title: inlineText(PROJECT_LIMITS.title),
  slug: slugSchema,
  clientName: inlineText(PROJECT_LIMITS.clientName),
  /** Category slugs, in the order the pills render. */
  categories: z.array(projectCategorySlug).max(PROJECT_LIMITS.categories),

  isFeatured: z.boolean(),
  position: z.number().int().min(0),

  cardImage: imageRefSchema.optional(),

  heroType: z.enum(['image', 'video']),
  heroImage: imageRefSchema.optional(),
  heroImageMobile: imageRefSchema.optional(),
  heroVideoUrl: z.string().max(PROJECT_LIMITS.videoUrl),
  heroLead: inlineText(PROJECT_LIMITS.heroLead),
  heroBody: inlineText(PROJECT_LIMITS.heroBody),

  /** Sanitised HTML (see rich-text.ts). Length checked on the visible text. */
  introHtml: z.string().max(20_000),

  featureHeading: inlineText(PROJECT_LIMITS.featureHeading),
  featureText: inlineText(PROJECT_LIMITS.featureText),
  featureImage: imageRefSchema.optional(),

  gallery: z.array(imageRefSchema).max(PROJECT_LIMITS.gallery),

  testimonialQuote: inlineText(PROJECT_LIMITS.testimonialQuote),
  testimonialAuthor: inlineText(120),
  testimonialCompany: inlineText(120),

  /** A linked CMS review (forms-reviews spec §11). Rendered instead of the inline fields when set. */
  reviewId: z.string().max(64).nullish(),

  relatedMode: z.enum(['auto', 'manual']),
  relatedIds: z.array(z.string().max(64)).max(PROJECT_LIMITS.related),

  seoTitle: inlineText(PROJECT_LIMITS.seoTitle),
  seoDescription: inlineText(PROJECT_LIMITS.seoDescription),
  ogImage: imageRefSchema.optional(),
})

export type ProjectInput = z.infer<typeof projectSchema>

/** Top-level keys the API accepts. Anything else is rejected. */
export const PROJECT_INPUT_KEYS = [
  'title',
  'slug',
  'clientName',
  'categories',
  'isFeatured',
  'position',
  'cardImage',
  'heroType',
  'heroImage',
  'heroImageMobile',
  'heroVideoUrl',
  'heroLead',
  'heroBody',
  'introHtml',
  'featureHeading',
  'featureText',
  'featureImage',
  'gallery',
  'testimonialQuote',
  'testimonialAuthor',
  'testimonialCompany',
  'reviewId',
  'relatedMode',
  'relatedIds',
  'seoTitle',
  'seoDescription',
  'ogImage',
] as const

/** Title → URL slug: lowercase words joined by single hyphens. */
export function slugify(value: string, max: number = PROJECT_LIMITS.slug): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

/** The empty draft a "New project" form starts from. */
export function emptyProject(): ProjectInput {
  return {
    title: '',
    slug: '',
    categories: [],
    isFeatured: false,
    position: 0,
    heroType: 'image',
    gallery: [],
    reviewId: null,
    relatedMode: 'auto',
    relatedIds: [],
  }
}

// --- Publish gate (§3) -------------------------------------------------------

export type PublishChecklistItem = {
  key: string
  label: string
  ok: boolean
  /** Soft problems: shown, but they do not block publishing. */
  warning?: boolean
}

/**
 * The itemised checklist the editor's Publish button is disabled by. The
 * server runs the same function, so the tooltip and the 422 can never disagree.
 */
export function projectPublishChecklist(project: Partial<ProjectInput>): PublishChecklistItem[] {
  const items: PublishChecklistItem[] = [
    { key: 'title', label: 'Title', ok: filled(project.title) },
    {
      key: 'slug',
      label: 'Slug (lowercase, hyphens)',
      ok: typeof project.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug),
    },
    {
      key: 'categories',
      label: 'At least one category',
      ok: Array.isArray(project.categories) && project.categories.length > 0,
    },
    {
      key: 'heroImage',
      label: 'Hero image',
      ok: Boolean(project.heroImage?.mediaId),
    },
    {
      key: 'heroImageAlt',
      label: 'Hero image alt text',
      ok: filled(project.heroImage?.alt),
    },
    { key: 'heroLead', label: 'Hero lead sentence', ok: filled(project.heroLead) },
  ]

  if (project.heroType === 'video') {
    items.push({
      key: 'heroVideoUrl',
      label: 'Hero video URL (https)',
      ok: typeof project.heroVideoUrl === 'string' && /^https:\/\//i.test(project.heroVideoUrl),
    })
  }

  items.push({
    key: 'featureImageAlt',
    label: 'Feature image alt text',
    ok: !project.featureImage?.mediaId || filled(project.featureImage.alt),
  })

  const missingGalleryAlt = (project.gallery ?? []).some((item) => !filled(item?.alt))
  items.push({
    key: 'galleryAlt',
    label: 'Alt text on every gallery image',
    ok: !missingGalleryAlt,
    warning: true,
  })

  return items
}

/** Field errors for the publish request; empty means publishable. */
export function projectPublishErrors(project: Partial<ProjectInput>): FieldError[] {
  const paths: Record<string, string> = {
    title: 'title',
    slug: 'slug',
    categories: 'categories',
    heroImage: 'heroImage',
    heroImageAlt: 'heroImage.alt',
    heroLead: 'heroLead',
    heroVideoUrl: 'heroVideoUrl',
    featureImageAlt: 'featureImage.alt',
  }

  return projectPublishChecklist(project)
    .filter((item) => !item.ok && !item.warning)
    .map((item) => ({ path: paths[item.key] ?? item.key, message: 'Required to publish' }))
}

export function isPublishable(project: Partial<ProjectInput>): boolean {
  return projectPublishErrors(project).length === 0
}

// --- Video host allow-list (§3) ---------------------------------------------

export const DEFAULT_VIDEO_HOSTS = ['ik.imagekit.io']

/* This package typechecks without DOM/node libs, but `URL` exists in every
   runtime the schema runs in (Workers, Node, the browser). */
type ParsedUrl = { protocol: string; hostname: string }
declare const URL: { new (url: string): ParsedUrl }

/**
 * `hero_video_url` must be https and its host must be allow-listed. The list
 * comes from the `ALLOWED_VIDEO_HOSTS` env var (comma separated) so the owner
 * can add a CDN without a code change.
 */
export function videoUrlError(url: string | undefined, allowedHosts: readonly string[]): string | null {
  if (!url) return null
  let parsed: ParsedUrl
  try {
    parsed = new URL(url)
  } catch {
    return 'Use a full https:// URL'
  }
  if (parsed.protocol !== 'https:') return 'The video URL must use https://'
  const hosts = allowedHosts.length > 0 ? allowedHosts : DEFAULT_VIDEO_HOSTS
  if (!hosts.includes(parsed.hostname.toLowerCase())) {
    return `The video host must be one of: ${hosts.join(', ')}`
  }
  return null
}

function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
