import { ADMIN_HEADERS, MAX_BODY_BYTES, error } from '@marino/api-kit'

/*
 * Request/response helpers for the admin API.
 *
 * Everything here is deliberately boring: the admin endpoints all need the
 * same JSON error shape, the same body limit, and the same "one bad row must
 * not take down the whole screen" pagination defaults.
 */

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response }

export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, response: error('bad_request', 'Send the body as application/json') }
  }

  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: error('payload_too_large', 'Body is too large') }
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, response: error('bad_request', 'Could not read the request body') }
  }

  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: error('payload_too_large', 'Body is too large') }
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: error('bad_request', 'Body is not valid JSON') }
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((item) => typeof item === 'string')) return undefined
  return value as string[]
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

/**
 * Lifecycle endpoints accept an optional `{ expectedVersion }` body. Missing
 * content type means "no body", which is a valid call from curl/health checks.
 */
export async function readExpectedVersion(request: Request): Promise<number | undefined> {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return undefined

  const body = await readJsonBody(request)
  if (!body.ok) return undefined
  return isObject(body.value) ? numberValue(body.value.expectedVersion) : undefined
}

export function pageParams(url: URL, defaultLimit = 25, maxLimit = 100) {
  const rawPage = Number(url.searchParams.get('page') ?? '1')
  const rawLimit = Number(url.searchParams.get('limit') ?? String(defaultLimit))
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1
  const limit = Number.isFinite(rawLimit)
    ? Math.min(maxLimit, Math.max(1, Math.floor(rawLimit)))
    : defaultLimit
  return { page, limit, offset: (page - 1) * limit }
}

export async function run(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (cause) {
    console.error('[admin] unhandled error', cause)
    return error('server_error', 'Something went wrong while handling that request')
  }
}

export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  // Excel formula injection: a cell beginning with one of these is treated as
  // a formula by Excel/Sheets. Prefixing an apostrophe makes it inert.
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

export function csvResponse(filename: string, rows: readonly (readonly unknown[])[]): Response {
  const body = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  const headers = new Headers(ADMIN_HEADERS)
  headers.set('Content-Type', 'text/csv; charset=utf-8')
  headers.set('Content-Disposition', `attachment; filename="${filename}"`)
  return new Response(body, { status: 200, headers })
}

/** Join the current query string with a filename for a CSV download label. */
export function datedFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`
}
