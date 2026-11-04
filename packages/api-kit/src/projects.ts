/*
 * Responsive image assets for case studies (cms-projects-spec.md §6).
 *
 * The admin's upload pipeline writes WebP variants to the shared bucket and
 * records them on the media row as JSON:
 *
 *   [{ "w": 480, "key": "cms/projects/med_…/480.webp" }, …]
 *
 * Both APIs build exactly the same `ImageAsset` from that row, so a `srcSet`
 * cannot mean different things in the CMS preview and on the live page.
 */

export type MediaVariant = { w: number; key: string }

export type ImageRefValue = {
  mediaId: string
  alt?: string
  focalX?: number
  focalY?: number
}

export type ImageAsset = {
  /** Largest variant (or the primary object when there are no variants). */
  url: string
  /** `"…480.webp 480w, …768.webp 768w"`, or a single entry. */
  srcSet: string
  width: number
  height: number
  alt: string
  /** 0–100, for `object-position`. */
  focalX: number
  focalY: number
}

export type ImageMediaRow = {
  id: string
  r2_key: string
  width: number | null
  height: number | null
  alt: string
  variants?: string | null
}

/** Parse the JSON variants column, ignoring anything malformed. */
export function parseVariants(value: string | null | undefined): MediaVariant[] {
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

export function mediaPublicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`
}

/**
 * Build the public asset shape for one image slot.
 *
 * `width`/`height` describe the URL actually used (the largest variant), scaled
 * from the row's intrinsic size, so the frontend can always emit width and
 * height attributes and nothing shifts while loading.
 */
export function buildImageAsset(
  base: string,
  row: ImageMediaRow,
  ref: ImageRefValue | null | undefined,
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

/** `ImageRef` values in a project, keyed by the JSON path they came from. */
export function collectImageRefs(value: unknown, found: ImageRefValue[] = []): ImageRefValue[] {
  if (Array.isArray(value)) {
    for (const item of value) collectImageRefs(item, found)
    return found
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.mediaId === 'string') {
      found.push({
        mediaId: record.mediaId,
        alt: typeof record.alt === 'string' ? record.alt : undefined,
        focalX: typeof record.focalX === 'number' ? record.focalX : undefined,
        focalY: typeof record.focalY === 'number' ? record.focalY : undefined,
      })
      return found
    }
    for (const child of Object.values(record)) collectImageRefs(child, found)
  }
  return found
}

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, Math.round(value)))
}
