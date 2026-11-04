/*
 * @marino/api-kit — shared server helpers for both Pages Functions bundles.
 *
 * Nothing here knows whether it is serving the public site or the admin: the
 * differences (published vs draft data, anonymous vs Access-authenticated) are
 * decided by the caller. That is deliberate — the two APIs cannot drift into
 * different ideas of what a media URL or an error body looks like.
 */

export * from './types'
export * from './ids'
export * from './http'
export * from './media'
export * from './cache'
export * from './audit'
export * from './auth'
export * from './projects'
export * from './preview'

/*
 * The RichInline grammar, re-exported (spec §4.5 "richInline helpers (shared
 * grammar)"). The site renders with these; the API uses `toPlainText` for SEO
 * fallbacks. One implementation, imported from `@marino/content-schema`.
 */
export { parseInline, parseParagraph, toPlainText, fromSegments } from '@marino/content-schema'
export type { InlineNode, InlineParagraph, RichSegment } from '@marino/content-schema'
