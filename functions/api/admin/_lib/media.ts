import { collectMediaIds, parseVariants, type Env } from '@marino/api-kit'
import { parseObject } from './db'

/*
 * Shared media helpers for the admin API.
 *
 * `@marino/api-kit` resolves media references for the public site (turning
 * `{ mediaId }` into `{ url, … }`). The admin needs the raw reference for the
 * editor and a URL for thumbnails at the same time, so it uses the same id
 * collector and returns a lookup map keyed by media id.
 */

export type MediaRow = {
  id: string
  r2_key: string
  kind: string
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  filename: string
  alt: string
  focus_x: number | null
  focus_y: number | null
  poster_media_id: string | null
  tags: string
  source: string
  deleted_at: string | null
  created_at: string
  variants: string | null
}

export type MediaView = {
  id: string
  url: string
  key: string
  kind: string
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  filename: string
  alt: string
  focus: { x: number; y: number } | null
  posterId: string | null
  tags: string[]
  source: string
  createdAt: string
  /** Responsive renditions, ascending; empty for GIF/SVG/legacy files. */
  variants: { w: number; url: string }[]
}

const MEDIA_COLUMNS =
  'id, r2_key, kind, mime, size, width, height, duration, filename, alt, focus_x, focus_y, poster_media_id, tags, source, deleted_at, created_at, variants'

export function mediaView(env: Env, row: MediaRow): MediaView {
  return {
    id: row.id,
    url: mediaUrl(env, row.r2_key),
    key: row.r2_key,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    duration: row.duration,
    filename: row.filename,
    alt: row.alt,
    focus:
      row.focus_x !== null && row.focus_y !== null ? { x: row.focus_x, y: row.focus_y } : null,
    posterId: row.poster_media_id,
    tags: tagsOf(row.tags),
    source: row.source,
    createdAt: row.created_at,
    variants: parseVariants(row.variants).map((variant) => ({
      w: variant.w,
      url: mediaUrl(env, variant.key),
    })),
  }
}

export function mediaUrl(env: Env, key: string): string {
  return `${env.MEDIA_PUBLIC_BASE.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`
}

export function tagsOf(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((tag) => typeof tag === 'string')
      ? (parsed as string[])
      : []
  } catch {
    return []
  }
}

export async function loadMedia(env: Env, id: string): Promise<MediaRow | null> {
  return env.DB.prepare(
    `SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<MediaRow>()
}

/**
 * Resolve every media reference inside `value` into a map keyed by id. Unlike
 * `resolveMedia`, the shape of the record is untouched — the editor keeps the
 * `{ mediaId }` reference and uses the map only to render a thumbnail.
 */
export async function mediaMapFor(
  env: Env,
  value: unknown,
): Promise<Record<string, MediaView>> {
  const ids = [...collectMediaIds(value)]
  if (ids.length === 0) return {}

  const placeholders = ids.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT ${MEDIA_COLUMNS} FROM media
      WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  )
    .bind(...ids)
    .all<MediaRow>()

  const map: Record<string, MediaView> = {}
  for (const row of results ?? []) map[row.id] = mediaView(env, row)
  return map
}

export type MediaUsage =
  | {
      kind: 'document'
      slug: string
      type: string
      title: string
      label: string
      collection: string
    }
  | {
      kind: 'entry'
      id: string
      collection: string
      label: string
    }
  | {
      kind: 'project'
      id: string
      slug: string
      title: string
      label: string
      collection: string
    }

/**
 * Find every record that references this media id. The JSON is written by
 * `JSON.stringify`, so the compact marker `"mediaId":"<id>"` is stable. We
 * search both the draft and the published snapshot: a file used by the live
 * site must not be deleted just because the draft dropped the reference.
 */
export async function findMediaUsage(env: Env, id: string): Promise<MediaUsage[]> {
  const marker = `%"mediaId":"${id}"%`

  const [documents, entries] = await Promise.all([
    env.DB.prepare(
      `SELECT slug, type, title FROM documents
        WHERE data LIKE ? OR published_data LIKE ?
        ORDER BY title COLLATE NOCASE`,
    )
      .bind(marker, marker)
      .all<{ slug: string; type: string; title: string }>(),
    env.DB.prepare(
      `SELECT id, collection, slug, data FROM entries
        WHERE data LIKE ? OR published_data LIKE ?
        ORDER BY collection, sort`,
    )
      .bind(marker, marker)
      .all<{ id: string; collection: string; slug: string | null; data: string }>(),
  ])

  const usage: MediaUsage[] = []

  for (const row of documents.results ?? []) {
    usage.push({
      kind: 'document',
      slug: row.slug,
      type: row.type,
      title: row.title,
      label: row.title,
      collection: row.type,
    })
  }

  for (const row of entries.results ?? []) {
    const data = parseObject(row.data) ?? {}
    usage.push({
      kind: 'entry',
      id: row.id,
      collection: row.collection,
      label: entryLabelFromData(row.collection, data),
    })
  }

  // Case studies keep an indexed `media_usage` table (rebuilt on every save).
  // The LIKE fallback covers a row written before that rebuild existed.
  const projects = await env.DB.prepare(
    `SELECT DISTINCT p.id, p.slug, p.title
       FROM projects p
      WHERE p.id IN (SELECT entity_id FROM media_usage WHERE media_id = ? AND entity = 'project')
         OR p.card_image LIKE ? OR p.hero_image LIKE ? OR p.hero_image_mobile LIKE ?
         OR p.feature_image LIKE ? OR p.gallery LIKE ? OR p.og_image LIKE ?
      ORDER BY p.title COLLATE NOCASE`,
  )
    .bind(id, marker, marker, marker, marker, marker, marker)
    .all<{ id: string; slug: string; title: string }>()

  for (const row of projects.results ?? []) {
    usage.push({ kind: 'project', id: row.id, slug: row.slug, title: row.title, label: row.title, collection: 'projects' })
  }

  return usage
}

function entryLabelFromData(collection: string, data: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'author', 'quote']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return collection
}
