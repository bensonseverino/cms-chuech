import { json, type Env, type PagesFunction } from '@marino/api-kit'
import { parseObject } from './_lib/db'
import { run } from './_lib/http'

/*
 * GET /api/admin/lookups — the small option lists the schema-driven editor
 * needs (project slugs, service titles, page slugs). Drafts are included so a
 * page can be edited before the thing it links to is published.
 */

type Option = { value: string; label: string }

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const [entries, pages] = await Promise.all([
      context.env.DB.prepare(
        `SELECT collection, slug, data FROM entries WHERE status != 'archived' ORDER BY collection, sort, slug`,
      ).all<{ collection: string; slug: string | null; data: string }>(),
      context.env.DB.prepare(
        `SELECT slug, type, title FROM documents
          WHERE type IN ('service_page', 'page') AND status != 'archived'
          ORDER BY title COLLATE NOCASE`,
      ).all<{ slug: string; type: string; title: string }>(),
    ])

    const grouped: Record<string, Option[]> = {
      services: [],
      projects: [],
      articles: [],
      testimonials: [],
      clients: [],
    }

    for (const row of entries.results ?? []) {
      const data = parseObject(row.data) ?? {}
      const option = optionFor(row.collection, row.slug, data)
      if (!option) continue
      const bucket = grouped[row.collection]
      if (bucket) bucket.push(option)
    }

    return json({
      services: grouped.services,
      projects: grouped.projects,
      articles: grouped.articles,
      testimonials: grouped.testimonials,
      clients: grouped.clients,
      pages: (pages.results ?? []).map((row) => ({
        value: row.slug,
        label: row.title,
        type: row.type,
      })),
    })
  })

function optionFor(
  collection: string,
  slug: string | null,
  data: Record<string, unknown>,
): Option | null {
  if (collection === 'services') {
    const title = text(data.title)
    // Project.services stores the service TITLE, not its slug.
    return title ? { value: title, label: title } : null
  }

  if (collection === 'projects' || collection === 'articles') {
    const title = text(data.title)
    const value = text(data.slug) ?? slug
    return title && value ? { value, label: title } : null
  }

  if (collection === 'testimonials') {
    const author = text(data.author)
    const company = text(data.company)
    const id = text(data.__id)
    if (!author) return null
    return {
      value: id ?? author,
      label: company ? `${author} — ${company}` : author,
    }
  }

  if (collection === 'clients') {
    const name = text(data.name)
    return name ? { value: name, label: name } : null
  }

  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
