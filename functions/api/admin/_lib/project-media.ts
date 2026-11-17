import { error, mediaId, parseVariants, type Env, type User } from '@marino/api-kit'
import { mediaView, type MediaRow } from './media'

/*
 * Responsive project-image upload (cms-projects-spec.md §6).
 *
 * The browser resizes the original to WebP at 480/768/1200/1920 (never
 * upscaling) and sends them in one multipart POST alongside `variantWidths`:
 *
 *   file?               optional original (unused when variants are supplied)
 *   variant             the WebP renditions, one part each
 *   variantWidths       "[480,768,1200]" — same order as the variant parts
 *   width, height       intrinsic dimensions of the original
 *   filename, alt       display metadata
 *
 * Each rendition is stored at `cms/projects/{mediaId}/{width}.webp`; the largest
 * becomes the row's primary key so `r2_key` and the variants always agree.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_VARIANTS = 4
/** Never upscale: a 300 px original legitimately yields a 300 px only variant. */
const MAX_VARIANT_WIDTH = 4096

export type ProjectUploadResult =
  | { ok: true; row: MediaRow }
  | { ok: false; response: Response }

export async function uploadProjectImage(
  env: Env,
  user: User,
  form: FormData,
  variantWidthsRaw: string,
): Promise<ProjectUploadResult> {
  let widths: number[]
  try {
    const parsed = JSON.parse(variantWidthsRaw) as unknown
    if (!Array.isArray(parsed)) throw new Error('not an array')
    widths = parsed.map((value) => Number(value))
  } catch {
    return { ok: false, response: error('bad_request', '`variantWidths` must be a JSON array') }
  }

  const variants = form.getAll('variant').filter((entry): entry is File => entry instanceof File)
  if (variants.length === 0) {
    return { ok: false, response: error('bad_request', 'No image variants were uploaded') }
  }
  if (variants.length !== widths.length) {
    return { ok: false, response: error('bad_request', 'Each variant needs a width') }
  }
  if (variants.length > MAX_VARIANTS) {
    return { ok: false, response: error('bad_request', `Upload at most ${MAX_VARIANTS} variants`) }
  }

  for (const [index, file] of variants.entries()) {
    const width = widths[index]
    if (!Number.isInteger(width) || width <= 0) {
      return { ok: false, response: error('bad_request', 'Variant widths must be whole pixels') }
    }
    if (width > MAX_VARIANT_WIDTH) {
      return { ok: false, response: error('bad_request', `Variant width ${width} is too large`) }
    }
    if (file.type.toLowerCase() !== 'image/webp') {
      return { ok: false, response: error('bad_request', 'Variants must be WebP') }
    }
    if (file.size <= 0) {
      return { ok: false, response: error('bad_request', 'A variant is empty') }
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        response: error('payload_too_large', 'Each variant must be 10 MB or smaller'),
      }
    }
  }

  if (new Set(widths).size !== widths.length) {
    return { ok: false, response: error('bad_request', 'Variant widths must be unique') }
  }

  const order = widths
    .map((width, index) => ({ width, file: variants[index] }))
    .sort((a, b) => a.width - b.width)

  const id = mediaId()
  const keys: string[] = []
  const stored: { w: number; key: string }[] = []

  try {
    for (const item of order) {
      const key = `cms/projects/${id}/${item.width}.webp`
      await env.MEDIA.put(key, await item.file.arrayBuffer(), {
        httpMetadata: {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      })
      keys.push(key)
      stored.push({ w: item.width, key })
    }
  } catch (cause) {
    console.error('[admin/media] variant R2 put failed', cause)
    await cleanup(env, keys)
    return { ok: false, response: error('server_error', 'Could not store the image variants') }
  }

  const largest = stored[stored.length - 1]
  const width = numberField(form.get('width')) ?? largest.w
  const height = numberField(form.get('height'))
  const filename =
    stringField(form.get('filename'))?.slice(0, 300) ??
    `project-${id.slice(-8).toLowerCase()}.webp`
  const alt =
    stringField(form.get('alt'))?.slice(0, 300) ??
    filename
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .slice(0, 300)

  try {
    await env.DB.prepare(
      `INSERT INTO media
         (id, r2_key, kind, mime, size, width, height, filename, alt, tags, source, created_by, variants)
       VALUES (?, ?, 'image', 'image/webp', ?, ?, ?, ?, ?, '[]', 'upload', ?, ?)`,
    )
      .bind(
        id,
        largest.key,
        order[order.length - 1].file.size,
        width,
        height,
        filename,
        alt,
        user.id,
        JSON.stringify(stored),
      )
      .run()
  } catch (cause) {
    console.error('[admin/media] variant insert failed; removing R2 objects', cause)
    await cleanup(env, keys)
    return { ok: false, response: error('server_error', 'Could not index the uploaded image') }
  }

  const row = await env.DB.prepare(
    `SELECT id, r2_key, kind, mime, size, width, height, duration, filename, alt,
            focus_x, focus_y, poster_media_id, tags, source, deleted_at, created_at, variants
       FROM media WHERE id = ?`,
  )
    .bind(id)
    .first<MediaRow>()

  if (!row) return { ok: false, response: error('server_error', 'The image could not be read back') }

  // Touch the parser so a malformed column is caught here rather than on the site.
  parseVariants(row.variants)

  return { ok: true, row }
}

export function projectImageView(env: Env, row: MediaRow) {
  return mediaView(env, row)
}

async function cleanup(env: Env, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await env.MEDIA.delete(key)
    } catch {
      // Best effort: the row was never written, so an orphan is harmless.
    }
  }
}

function stringField(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberField(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined
}
