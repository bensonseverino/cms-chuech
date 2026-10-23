import {
  COLLECTIONS,
  DOCUMENTS,
  isCollectionName,
  isDocumentType,
  validateRecord,
  type FieldError,
  type RecordSchema,
  type ValidationLevel,
} from '@marino/content-schema'
import type { Env, PagesContext, User } from '@marino/api-kit'

/*
 * Admin data access.
 *
 * The public API lives in `site-integration/` and only ever reads
 * `published_data`. The admin API is the opposite: it reads and writes the
 * draft `data` and promotes it on publish. Keeping those two stores separate
 * is the whole draft/publish contract, so every helper here is explicit about
 * which column it touches.
 */

export type DocumentRow = {
  slug: string
  type: string
  title: string
  status: string
  data: string
  published_data: string | null
  version: number
  published_at: string | null
  updated_at: string
  created_at: string
}

export type EntryRow = {
  id: string
  collection: string
  slug: string | null
  status: string
  sort: number
  data: string
  published_data: string | null
  version: number
  published_at: string | null
  updated_at: string
  created_at: string
}

export type DocumentView = {
  slug: string
  type: string
  title: string
  status: string
  data: Record<string, unknown>
  publishedData: Record<string, unknown> | null
  version: number
  publishedAt: string | null
  updatedAt: string
  createdAt: string
  changed: boolean
  hasPublished: boolean
}

export type EntryView = {
  id: string
  collection: string
  slug: string | null
  status: string
  sort: number
  data: Record<string, unknown>
  publishedData: Record<string, unknown> | null
  version: number
  publishedAt: string | null
  updatedAt: string
  createdAt: string
  changed: boolean
  hasPublished: boolean
}

export type RecordDefinition = {
  schema: RecordSchema<Record<string, unknown>>
  required: readonly string[]
  fields: readonly unknown[]
}

const DOCUMENT_COLUMNS =
  'slug, type, title, status, data, published_data, version, published_at, updated_at, created_at'
const ENTRY_COLUMNS =
  'id, collection, slug, status, sort, data, published_data, version, published_at, updated_at, created_at'

export function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function documentView(row: DocumentRow): DocumentView {
  const data = parseObject(row.data) ?? {}
  const publishedData = parseObject(row.published_data)

  return {
    slug: row.slug,
    type: row.type,
    title: row.title,
    status: row.status,
    data,
    publishedData,
    version: row.version,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    changed: row.published_data === null || row.data !== row.published_data,
    hasPublished: row.published_data !== null,
  }
}

export function entryView(row: EntryRow): EntryView {
  const data = parseObject(row.data) ?? {}
  const publishedData = parseObject(row.published_data)

  return {
    id: row.id,
    collection: row.collection,
    slug: row.slug,
    status: row.status,
    sort: row.sort,
    data,
    publishedData,
    version: row.version,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    changed: row.published_data === null || row.data !== row.published_data,
    hasPublished: row.published_data !== null,
  }
}

export async function loadDocument(env: Env, slug: string): Promise<DocumentRow | null> {
  return env.DB.prepare(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE slug = ?`)
    .bind(slug)
    .first<DocumentRow>()
}

export async function loadEntry(
  env: Env,
  collection: string,
  id: string,
): Promise<EntryRow | null> {
  return env.DB.prepare(
    `SELECT ${ENTRY_COLUMNS} FROM entries WHERE collection = ? AND id = ?`,
  )
    .bind(collection, id)
    .first<EntryRow>()
}

export function documentDefinition(type: string) {
  return isDocumentType(type) ? DOCUMENTS[type] : null
}

export function collectionDefinition(collection: string) {
  return isCollectionName(collection) ? COLLECTIONS[collection] : null
}

export function isValidDocumentType(value: string): boolean {
  return isDocumentType(value)
}

export function isValidCollection(value: string): boolean {
  return isCollectionName(value)
}

export function isSingletonDocument(slug: string): boolean {
  return slug.startsWith('_')
}

/**
 * Site identity, navigation and footer are administrator-only in the role
 * matrix (spec Phase 7). They are still ordinary singleton documents, so this
 * one list is shared by every write endpoint instead of checked per screen.
 */
const SETTINGS_DOCUMENT_SLUGS = new Set(['_site', '_navigation', '_footer'])

export function isSettingsDocument(slug: string): boolean {
  return SETTINGS_DOCUMENT_SLUGS.has(slug)
}

export type ContentResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: FieldError[] }

export function validateContent(
  schema: RecordSchema<unknown>,
  required: readonly string[],
  value: Record<string, unknown>,
  level: ValidationLevel,
): { ok: true; data: Record<string, unknown> } | { ok: false; errors: FieldError[] } {
  const result = validateRecord(schema, required, value, level)
  if (!result.ok) return { ok: false, errors: result.errors }
  return { ok: true, data: isPlainObject(result.data) ? result.data : (result.data as Record<string, unknown>) }
}

/**
 * The slug column mirrors `data.slug` for the three slugged collections.
 * Testimonials and clients have no slug; the column stays NULL.
 */
export function entrySlug(collection: string, data: Record<string, unknown>): string | null {
  if (collection !== 'services' && collection !== 'projects' && collection !== 'articles') {
    return null
  }

  const value = data.slug
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function entryLabel(collection: string, data: Record<string, unknown>): string {
  const candidates = ['title', 'name', 'author', 'quote']
  for (const key of candidates) {
    const value = data[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return collection
}

export function currentUser(context: PagesContext<Env>): User {
  const user = context.data.user
  if (!user || typeof user !== 'object') {
    // Middleware always sets this; reaching here means the route was mounted
    // outside the protected prefix.
    throw new Error('Admin middleware did not attach a user')
  }
  return user as User
}

export function actorOf(user: User): { email: string } {
  return { email: user.email }
}
