/*
 * Display formatting. Timestamps from D1 are UTC without a zone suffix
 * (`datetime('now')`), so they are normalised here before being parsed; a raw
 * `new Date('2026-10-23 10:00:00')` is interpreted inconsistently by browsers.
 */

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalised = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalised)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function relativeTime(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return '—'

  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ]

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function entryTitle(data: Record<string, unknown>, fallback = 'Untitled'): string {
  for (const key of ['title', 'name', 'author', 'quote']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return fallback
}

export function entrySubtitle(data: Record<string, unknown>): string {
  for (const key of ['company', 'description', 'excerpt', 'slug']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

export function statusTone(status: string): 'mint' | 'lavender' | 'neutral' | 'dark' {
  if (status === 'published' || status === 'new') return 'mint'
  if (status === 'draft' || status === 'replied') return 'lavender'
  if (status === 'archived' || status === 'read') return 'neutral'
  return 'dark'
}

export function statusLabel(status: string): string {
  if (status === 'new') return 'New'
  if (status === 'read') return 'Read'
  if (status === 'replied') return 'Replied'
  if (status === 'spam') return 'Spam'
  if (status === 'archived') return 'Archived'
  if (status === 'draft') return 'Draft'
  if (status === 'published') return 'Published'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function initials(value: string): string {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}
