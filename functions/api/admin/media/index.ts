import {
  audit,
  error,
  json,
  mediaId,
  requireRole,
  type Env,
  type PagesFunction,
  type User,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { mediaView, type MediaRow } from '../_lib/media'
import { pageParams, run } from '../_lib/http'

/*
 * GET  /api/admin/media — list/search the library
 * POST /api/admin/media — multipart upload (one or many files)
 *
 * Uploads land under `uploads/YYYY/MM/` and the R2 key is immutable. The
 * database row is written after R2 succeeds; if the row fails, the object is
 * removed again so the bucket never accumulates invisible orphans.
 */

const MEDIA_COLUMNS =
  'id, r2_key, kind, mime, size, width, height, duration, filename, alt, focus_x, focus_y, poster_media_id, tags, source, deleted_at, created_at'

const KINDS = new Set(['image', 'video', 'svg', 'file'])
const SOURCES = new Set(['upload', 'import', 'seed'])
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 20
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024

const MIME: Record<string, { kind: string; ext: string }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/gif': { kind: 'image', ext: 'gif' },
  'image/avif': { kind: 'image', ext: 'avif' },
  'image/svg+xml': { kind: 'svg', ext: 'svg' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/webm': { kind: 'video', ext: 'webm' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'application/pdf': { kind: 'file', ext: 'pdf' },
}

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const url = new URL(context.request.url)
    const { page, limit, offset } = pageParams(url, 24, 100)
    const q = url.searchParams.get('q')?.trim()
    const kind = url.searchParams.get('kind')?.trim()
    const source = url.searchParams.get('source')?.trim()

    if (kind && !KINDS.has(kind)) return error('bad_request', 'Unknown media kind')
    if (source && !SOURCES.has(source)) return error('bad_request', 'Unknown media source')

    const conditions = ['deleted_at IS NULL']
    const bindings: unknown[] = []

    if (kind) {
      // The UI groups raster images and SVG under "Images"; both are image
      // slots in the content schema, so the filter must too.
      if (kind === 'image') {
        conditions.push("kind IN ('image', 'svg')")
      } else {
        conditions.push('kind = ?')
        bindings.push(kind)
      }
    }
    if (source) {
      conditions.push('source = ?')
      bindings.push(source)
    }
    if (q) {
      conditions.push('(filename LIKE ? OR alt LIKE ? OR tags LIKE ?)')
      bindings.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }

    const where = conditions.join(' AND ')
    const [countRow, rows] = await Promise.all([
      context.env.DB.prepare(`SELECT COUNT(*) AS count FROM media WHERE ${where}`)
        .bind(...bindings)
        .first<{ count: number }>(),
      context.env.DB.prepare(
        `SELECT ${MEDIA_COLUMNS} FROM media
          WHERE ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(...bindings, limit, offset)
        .all<MediaRow>(),
    ])

    return json({
      items: (rows.results ?? []).map((row) => mediaView(context.env, row)),
      total: countRow?.count ?? 0,
      page,
      limit,
    })
  })

export const onRequestPost: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'editor')
    if (roleError) return roleError

    const contentType = context.request.headers.get('Content-Type') ?? ''
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return error('bad_request', 'Upload files as multipart/form-data')
    }

    const declared = Number(context.request.headers.get('Content-Length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return error('payload_too_large', 'Upload is larger than 60 MB')
    }

    let form: FormData
    try {
      form = await context.request.formData()
    } catch {
      return error('bad_request', 'Could not read the uploaded files')
    }

    const files = [...form.getAll('file'), ...form.getAll('files')].filter(
      (entry): entry is File => entry instanceof File,
    )

    if (files.length === 0) return error('bad_request', 'No files were uploaded')
    if (files.length > MAX_FILES) {
      return error('bad_request', `Upload at most ${MAX_FILES} files at a time`)
    }

    if (files.some((file) => isSvg(file))) {
      const svgError = requireRole(user, 'admin')
      if (svgError) return error('forbidden', 'Only an admin may upload SVG files')
    }

    const uploaded: MediaRow[] = []
    for (const file of files) {
      const result = await storeFile(context.env, user, file)
      if (!result.ok) return result.response
      uploaded.push(result.row)
    }

    for (const row of uploaded) {
      await audit(context.env, actorOf(user), 'upload', 'media', row.id, `Uploaded ${row.filename}`)
    }

    return json(
      { items: uploaded.map((row) => mediaView(context.env, row)) },
      { status: 201 },
    )
  })

type StoreResult =
  | { ok: true; row: MediaRow }
  | { ok: false; response: Response }

async function storeFile(env: Env, user: User, file: File): Promise<StoreResult> {
  if (file.size <= 0) return { ok: false, response: error('bad_request', 'A file is empty') }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      response: error('payload_too_large', `'${file.name}' is larger than 10 MB`),
    }
  }

  const mime = file.type.toLowerCase() || mimeFromName(file.name)
  const meta = MIME[mime]
  if (!meta) {
    return {
      ok: false,
      response: error('bad_request', `'${file.name}' is not an allowed file type (${mime || 'unknown'})`),
    }
  }

  const id = mediaId()
  const safeMime = MIME[mime] ? mime : 'application/octet-stream'
  const safeName = slugFilename(file.name)
  const key = `uploads/${yearMonth()}/${id}-${safeName}.${meta.ext}`
  const bytes = await file.arrayBuffer()

  try {
    await env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType: safeMime,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })
  } catch (cause) {
    console.error('[admin/media] R2 put failed', cause)
    return { ok: false, response: error('server_error', `Could not store '${file.name}'`) }
  }

  const alt = file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .slice(0, 300)

  try {
    await env.DB.prepare(
      `INSERT INTO media
         (id, r2_key, kind, mime, size, filename, alt, tags, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'upload', ?)`,
    )
      .bind(id, key, meta.kind, safeMime, file.size, file.name.slice(0, 300), alt, user.id)
      .run()
  } catch (cause) {
    console.error('[admin/media] insert failed; removing R2 object', cause)
    try {
      await env.MEDIA.delete(key)
    } catch {
      // Best effort: the row is missing either way.
    }
    return { ok: false, response: error('server_error', `Could not index '${file.name}'`) }
  }

  const row = await env.DB.prepare(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ?`)
    .bind(id)
    .first<MediaRow>()

  if (!row) return { ok: false, response: error('server_error', 'Uploaded file could not be read back') }
  return { ok: true, row }
}

function isSvg(file: File): boolean {
  return file.type.toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file.name)
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const found = Object.entries(MIME).find(([, value]) => value.ext === ext)
  return found?.[0] ?? ''
}

function slugFilename(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'file'
}

function yearMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}
