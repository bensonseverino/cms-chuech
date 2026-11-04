/*
 * The intro statement's rich text (cms-projects-spec.md §4).
 *
 * Stored as sanitised HTML with a deliberately tiny allow-list:
 *
 *   p, br, strong, em, a[href], mark[data-highlight]
 *
 * Nothing else survives. There is no DOM in a Worker (and no Node-only
 * sanitizer is acceptable), so this is a small hand-written tokeniser: it walks
 * the string, escapes every text run, drops any tag or attribute not on the
 * list, and removes the content of script/style elements entirely. Tags are
 * re-emitted from the allow-list rather than copied, so an attribute that is
 * not explicitly understood cannot leak through.
 *
 * The same function runs on write (admin API) and is idempotent, so a stored
 * value can be re-sanitised safely on read.
 */

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'a', 'mark'])

/** Elements whose *content* is dropped, not just their tags. */
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript'])

const VOID_TAGS = new Set(['br'])

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; raw: string; closing: boolean; selfClosing: boolean; name: string }

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Sanitise intro HTML against the allow-list. Never throws: any malformed
 * input is returned as escaped text.
 */
export function sanitizeIntroHtml(input: string | null | undefined): string {
  if (!input) return ''

  const source = input.length > 20_000 ? input.slice(0, 20_000) : input
  const tokens = tokenize(source)
  const out: string[] = []
  const open: string[] = []
  let dropping: string | null = null

  for (const token of tokens) {
    if (token.kind === 'text') {
      if (!dropping) out.push(escapeHtml(token.value))
      continue
    }

    if (dropping) {
      if (token.closing && token.name === dropping) dropping = null
      continue
    }

    if (DROP_CONTENT.has(token.name)) {
      if (!token.closing && !token.selfClosing) dropping = token.name
      continue
    }

    if (!ALLOWED_TAGS.has(token.name)) continue

    if (token.closing) {
      // Close the nearest matching element; ignore stray closers.
      const index = open.lastIndexOf(token.name)
      if (index === -1) continue
      for (let i = open.length - 1; i >= index; i -= 1) {
        out.push(`</${open[i]}>`)
        open.pop()
      }
      continue
    }

    if (VOID_TAGS.has(token.name)) {
      out.push(`<${token.name}>`)
      continue
    }

    // A fresh <p> implicitly closes an open paragraph.
    if (token.name === 'p' && open[open.length - 1] === 'p') {
      out.push('</p>')
      open.pop()
    }

    out.push(`<${token.name}${attributesFor(token.name, token.raw)}>`)
    open.push(token.name)
  }

  // Balance anything left open so the stored value is always well-formed.
  while (open.length > 0) out.push(`</${open.pop()}>`)

  return out.join('')
}

/** Plain text of intro HTML, for SEO fallbacks and previews. */
export function introHtmlToText(input: string | null | undefined): string {
  if (!input) return ''
  return decodeEntities(
    sanitizeIntroHtml(input)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|mark|strong|em|a)>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** How many characters of visible text the stored HTML contains. */
export function introHtmlLength(input: string | null | undefined): number {
  return introHtmlToText(input).length
}

// --- Tokeniser ---------------------------------------------------------------

function tokenize(value: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0

  while (cursor < value.length) {
    const lt = value.indexOf('<', cursor)
    if (lt === -1) {
      tokens.push({ kind: 'text', value: value.slice(cursor) })
      break
    }

    if (lt > cursor) tokens.push({ kind: 'text', value: value.slice(cursor, lt) })

    const gt = value.indexOf('>', lt)
    if (gt === -1) {
      // An unterminated `<` is text, not a tag.
      tokens.push({ kind: 'text', value: value.slice(lt) })
      break
    }

    const raw = value.slice(lt, gt + 1)
    const inner = raw.slice(1, -1).trim()

    if (inner.startsWith('!--')) {
      // Comment: drop it (but only as far as this token; a `-->` body is text).
      cursor = gt + 1
      continue
    }

    const parsed = parseTag(raw, inner)
    if (parsed) tokens.push(parsed)
    else tokens.push({ kind: 'text', value: raw })

    cursor = gt + 1
  }

  return tokens
}

function parseTag(raw: string, inner: string): Token | null {
  if (!inner) return null

  const closing = inner.startsWith('/')
  const body = closing ? inner.slice(1).trim() : inner
  const selfClosing = body.endsWith('/')
  const withoutSlash = selfClosing ? body.slice(0, -1).trim() : body

  const match = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(withoutSlash)
  if (!match) return null

  const name = match[1].toLowerCase()
  return { kind: 'tag', raw, closing, selfClosing, name }
}

// --- Attribute allow-list ----------------------------------------------------

function attributesFor(tag: string, raw: string): string {
  if (tag === 'mark') return ' data-highlight'
  if (tag !== 'a') return ''

  const href = readAttribute(raw, 'href')
  if (!href || !isSafeHref(href)) return ''

  return ` href="${escapeHtml(href)}" rel="noopener noreferrer"`
}

function readAttribute(raw: string, name: string): string | null {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i',
  )
  const found = pattern.exec(raw)
  if (!found) return null
  return found[1] ?? found[2] ?? found[3] ?? null
}

/** `/path`, `https://…`, `mailto:` and `tel:` only. Never `javascript:`. */
export function isSafeHref(value: string): boolean {
  const href = value.trim()
  if (!href) return false
  if (href.startsWith('/') && !href.startsWith('//') && !/\s/.test(href)) return true
  if (/^https:\/\/[^\s]+$/i.test(href)) return true
  if (/^mailto:[^\s]+$/i.test(href)) return true
  if (/^tel:[+0-9().\-\s]+$/i.test(href)) return true
  return false
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
