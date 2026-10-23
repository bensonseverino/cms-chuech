import type { FieldError } from './types'

/*
 * The one fetch wrapper for the admin API.
 *
 * Every mutation carries `X-Requested-With: XMLHttpRequest` (the middleware's
 * CSRF check). Errors are normalised into `ApiError` so screens can bind field
 * messages and show a human message without guessing the response shape.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: FieldError[]

  constructor(status: number, code: string, message: string, fields: FieldError[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = new Headers(options.headers)

  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-Requested-With', 'XMLHttpRequest')
  }

  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }

  const response = await fetch(`/api/admin${path}`, {
    ...options,
    method,
    headers,
    body,
    credentials: 'same-origin',
  })

  if (!response.ok) {
    let code = 'server_error'
    let message = `Request failed (${response.status})`
    let fields: FieldError[] = []

    try {
      const parsed = (await response.json()) as {
        error?: { code?: string; message?: string; fields?: FieldError[] }
      }
      if (parsed.error) {
        code = parsed.error.code ?? code
        message = parsed.error.message ?? message
        fields = parsed.error.fields ?? []
      }
    } catch {
      // A non-JSON error (Pages 404, Access HTML) keeps the generic message.
    }

    throw new ApiError(response.status, code, message, fields)
  }

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await response.text()
    const looksLikeHtml = /^\s*<!doctype html|^\s*<html[\s>]/i.test(text)
    throw new ApiError(
      response.status,
      'invalid_response',
      looksLikeHtml
        ? 'The admin API returned HTML instead of JSON. Cloudflare Access may be intercepting the request, or the Pages Functions are not deployed.'
        : 'The admin API returned an unexpected non-JSON response.',
    )
  }

  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
}

export function queryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  if (cause instanceof Error) return cause.message
  return 'Something went wrong'
}

/**
 * Upload files with progress. The fetch API cannot report upload progress, so
 * this one place uses XHR. It sends the same CSRF header as `apiRequest`.
 */
export function uploadMedia(
  files: File[],
  onProgress: (percent: number) => void,
): Promise<{ items: import('./types').MediaView[] }> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const file of files) form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/media')
    xhr.withCredentials = true
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })

    xhr.addEventListener('load', () => {
      const contentType = xhr.getResponseHeader('Content-Type') ?? ''
      if (!contentType.includes('application/json')) {
        const looksLikeHtml = /^\s*<!doctype html|^\s*<html[\s>]/i.test(xhr.responseText)
        reject(
          new ApiError(
            xhr.status,
            'invalid_response',
            looksLikeHtml
              ? 'The admin API returned HTML instead of JSON. Cloudflare Access may be intercepting the request, or the Pages Functions are not deployed.'
              : 'The admin API returned an unexpected non-JSON response.',
          ),
        )
        return
      }
      try {
        const parsed = JSON.parse(xhr.responseText) as {
          items?: import('./types').MediaView[]
          error?: { code?: string; message?: string; fields?: import('./types').FieldError[] }
        }
        if (xhr.status >= 200 && xhr.status < 300 && parsed.items) {
          resolve({ items: parsed.items })
          return
        }
        reject(
          new ApiError(
            xhr.status,
            parsed.error?.code ?? 'server_error',
            parsed.error?.message ?? `Upload failed (${xhr.status})`,
            parsed.error?.fields ?? [],
          ),
        )
      } catch {
        reject(new ApiError(xhr.status, 'server_error', `Upload failed (${xhr.status})`))
      }
    })

    xhr.addEventListener('error', () => reject(new ApiError(0, 'network', 'Upload failed')))
    xhr.addEventListener('abort', () => reject(new ApiError(0, 'aborted', 'Upload cancelled')))
    xhr.send(form)
  })
}
