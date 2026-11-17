import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * Seed the case-study data (cms-projects-spec.md §10): the five categories,
 * the `call-back` form and three projects — Eventotron (published when real
 * images exist), WR Partners and Latakoo (drafts, so Similar Work can be
 * verified once they are published).
 *
 *   node scripts/seed-projects.mjs                # local D1 + local R2
 *   node scripts/seed-projects.mjs --remote       # production resources
 *
 * The seed is idempotent: categories, the form and the projects are upserted
 * by slug; media by id. Placeholder images are the site repo's shared SVGs.
 * A seeded project that still shows placeholders is left as a DRAFT (spec §10:
 * never publish placeholder images) unless --publish-placeholders is passed.
 */

const remote = process.argv.includes('--remote')
const publishPlaceholders = process.argv.includes('--publish-placeholders')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const siteRoot =
  process.env.CHUECH_SITE_ROOT ?? resolve(root, '..', '..', 'website', 'my-project')
const assetsRoot = join(siteRoot, 'src', 'assets', 'marino')
const publicRoot = join(siteRoot, 'public')
const configPath = join(root, 'admin', 'wrangler.toml')
const persistTo = join(root, '.wrangler', 'state')
const temp = mkdtempSync(join(tmpdir(), 'projects-seed-'))

const config = readFileSync(configPath, 'utf8')
const bucket = /bucket_name\s*=\s*"([^"]+)"/.exec(config)?.[1]
if (!bucket) throw new Error('Could not read bucket_name from admin/wrangler.toml')

/* ------------------------------------------------------------------ media -- */

let offset = 0
const seedId = () => `01JPROJ${String(++offset).padStart(19, '0')}`

/**
 * An image for one slot. Real files first (the owner's exported screenshots/
 * exports, checked under `site/public/` then `site/src/assets/marino/`), then
 * the shared placeholder SVG.
 */
function image(slotName, realFilename, alt, placeholder) {
  const candidates = [join(publicRoot, realFilename ?? ''), join(assetsRoot, realFilename ?? '')]
  const real = candidates.find((path) => realFilename && existsSync(path))
  const path = real ?? join(assetsRoot, placeholder)
  if (!existsSync(path)) throw new Error(`Missing image file: ${path}`)

  const body = readFileSync(path)
  const isSvg = path.endsWith('.svg')
  const id = `med_${seedId()}`
  // SVGs and GIFs are stored as-is with no variants (spec §6); the same is
  // true of these seed placeholders — the CMS upload pipeline adds variants
  // the first time the owner replaces the file.
  const r2Key = `cms/projects/${id}/original.${isSvg ? 'svg' : path.split('.').pop()}`
  const viewBox = isSvg ? /viewBox=["']([^"']+)["']/.exec(body.toString('utf8')) : null
  let width = null
  let height = null
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      width = Math.round(parts[2])
      height = Math.round(parts[3])
    }
  }

  return {
    id,
    r2Key,
    path,
    body,
    mime: isSvg ? 'image/svg+xml' : `image/${path.endsWith('.png') ? 'png' : 'jpeg'}`,
    size: body.length,
    width,
    height,
    isPlaceholder: !real,
    alt,
    slotName,
  }
}

function ref(imageRow, alt) {
  return {
    mediaId: imageRow.id,
    alt: alt ?? imageRow.alt,
    focalX: 50,
    focalY: 50,
  }
}

const categories = ['Branding', 'Web Design', 'SEO', 'PPC', 'Video']
const categorySlugs = (labels) =>
  labels.map((label) =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  )

/* ---------------------------------------------------------------- projects -- */

const eventotronImages = {
  hero: image('eventotron-hero', 'eventotron-hero.jpg', 'Eventotron hero — bold brand artwork', 'work-ph.svg'),
  feature: image(
    'eventotron-feature',
    'eventotron-feature.jpg',
    'The Eventotron logo lockup on yellow',
    'work-ph.svg',
  ),
  gallery: [
    ['Lavender “IT’S ON” card', 'eventotron-1.jpg'],
    ['Black colour-palette card', 'eventotron-2.jpg'],
    ['Orange “60,000” stat card', 'eventotron-3.jpg'],
    ['“Get Your Event On” photo', 'eventotron-4.jpg'],
    ['Collage grid', 'eventotron-5.jpg'],
    ['Yellow logo lockup variant', 'eventotron-6.jpg'],
  ].map(([alt, filename]) => image('eventotron-gallery', filename, alt, 'work-ph.svg')),
}
const wrImages = { card: image('wr-partners-card', 'wr-partners-card.jpg', 'WR Partners project card', 'work-ph.svg') }
const latakooImages = { card: image('latakoo-card', 'latakoo-card.jpg', 'Latakoo project card', 'work-ph.svg') }

const allImages = [
  eventotronImages.hero,
  eventotronImages.feature,
  ...eventotronImages.gallery,
  wrImages.card,
  latakooImages.card,
]
const eventotronHasPlaceholders = allImages.some((row) => row.isPlaceholder)
const eventotronStatus = eventotronHasPlaceholders && !publishPlaceholders ? 'draft' : 'published'

const projects = [
  {
    slug: 'eventotron',
    title: 'Eventotron',
    client_name: 'Eventotron',
    status: eventotronStatus,
    is_featured: 1,
    position: 10,
    categories: ['branding'],
    card_image: null,
    hero_type: 'image',
    hero_image: ref(eventotronImages.hero),
    hero_image_mobile: null,
    hero_video_url: null,
    hero_lead: 'A bold new brand and website for the platform powering live events.',
    hero_body:
      'Eventotron helps festivals, venues, producers and promoters simplify the work behind the scenes – bringing event registration, artist communication, ticketing, payments and settlements into one place.',
    intro_html:
      '<p>We created a <mark data-highlight>new identity</mark> designed to feel as <mark data-highlight>energetic and creative</mark> as the industry itself. At the centre of the brand is the <mark data-highlight>raised ‘O’</mark> – a simple visual device representing <mark data-highlight>movement, momentum and events</mark> that stand out.</p>',
    feature_heading: 'Get Your Event On',
    feature_text:
      'The idea was carried through a bold typographic style, bright colour palette and the new “Get Your Event On” strapline, before being brought to life across a completely new website.',
    feature_image: ref(eventotronImages.feature),
    gallery: JSON.stringify(eventotronImages.gallery.map((row) => ref(row))),
    testimonial_quote:
      'Marino really understood what we wanted Eventotron to become. They took the time to understand the platform, our audience and the personality behind the brand, then turned that into an identity and website that feels completely right for us. The new brand is bold, fun and distinctive, and we’re really pleased with how everything has come together.',
    testimonial_author: 'Holly',
    testimonial_company: 'Eventotron',
    related_mode: 'auto',
    related_ids: '[]',
    seo_title: 'Eventotron | Chuech Studio',
    seo_description:
      'A bold new brand and website for the platform powering live events.',
    og_image: null,
  },
  {
    slug: 'wr-partners',
    title: 'WR Partners',
    client_name: 'WR Partners',
    status: 'draft',
    is_featured: 0,
    position: 20,
    categories: ['branding', 'web-design', 'seo', 'ppc', 'video'],
    card_image: ref(wrImages.card),
    hero_type: 'image',
    hero_image: ref(wrImages.card),
    hero_image_mobile: null,
    hero_video_url: null,
    hero_lead: null,
    hero_body: null,
    intro_html: null,
    feature_heading: null,
    feature_text: null,
    feature_image: null,
    gallery: '[]',
    testimonial_quote: null,
    testimonial_author: null,
    testimonial_company: null,
    related_mode: 'auto',
    related_ids: '[]',
    seo_title: null,
    seo_description: null,
    og_image: null,
  },
  {
    slug: 'latakoo',
    title: 'Latakoo',
    client_name: 'Latakoo',
    status: 'draft',
    is_featured: 0,
    position: 30,
    categories: ['branding', 'web-design', 'seo', 'ppc'],
    card_image: ref(latakooImages.card),
    hero_type: 'image',
    hero_image: ref(latakooImages.card),
    hero_image_mobile: null,
    hero_video_url: null,
    hero_lead: null,
    hero_body: null,
    intro_html: null,
    feature_heading: null,
    feature_text: null,
    feature_image: null,
    gallery: '[]',
    testimonial_quote: null,
    testimonial_author: null,
    testimonial_company: null,
    related_mode: 'auto',
    related_ids: '[]',
    seo_title: null,
    seo_description: null,
    og_image: null,
  },
]

/* --------------------------------------------------------------------- SQL -- */

function quote(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  // ImageRef objects (card_image, hero_image, feature_image, og_image) must be
  // stored as JSON — the public API parses the column with JSON.parse.
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'`
  return `'${String(value).replaceAll("'", "''")}'`
}

const statements = ['PRAGMA foreign_keys = ON;']

// Categories (idempotent; the migration also seeds these).
categories.forEach((label, index) => {
  const slug = categorySlugs([label])[0]
  statements.push(`INSERT INTO project_categories (id, slug, label, position, created_at, updated_at)
    VALUES ('cat_${slug.replaceAll('-', '_')}', ${quote(slug)}, ${quote(label)}, ${index * 10}, datetime('now'), datetime('now'))
    ON CONFLICT(slug) DO UPDATE SET label = excluded.label, position = excluded.position, updated_at = datetime('now');`)
})

// The `call-back` form (idempotent; the migration also seeds this).
statements.push(`INSERT OR IGNORE INTO forms (source, label, enabled, notify_emails, success_message, auto_registered)
  VALUES ('call-back', 'Request a Call Back', 1, '[]', 'Thanks — we''ll call you back shortly.', 1);`)

// Media rows.
for (const row of allImages) {
  statements.push(`INSERT INTO media (
    id, r2_key, kind, mime, size, width, height, duration, filename, alt,
    focus_x, focus_y, poster_media_id, tags, source, created_by, created_at
  ) VALUES (
    ${quote(row.id)}, ${quote(row.r2Key)}, ${quote(row.isPlaceholder ? 'svg' : 'image')},
    ${quote(row.mime)}, ${quote(row.size)}, ${quote(row.width)}, ${quote(row.height)}, NULL,
    ${quote(row.slotName)}, ${quote(row.alt)}, NULL, NULL, NULL, '["seed","project"]', 'seed',
    NULL, datetime('now')
  ) ON CONFLICT(id) DO UPDATE SET
    r2_key = excluded.r2_key,
    mime = excluded.mime,
    size = excluded.size,
    width = excluded.width,
    height = excluded.height,
    alt = excluded.alt,
    deleted_at = NULL;`)
}

// Projects.
for (const project of projects) {
  const publishedAt = project.status === 'published' ? "datetime('now')" : 'NULL'
  // `categories` is a seed-level field resolved into project_category_map below, not a column.
  const columns = Object.keys(project).filter((column) => column !== 'categories')
  // Deterministic id (the seed objects don't carry one; a NULL id would break the
  // project_category_map / media_usage foreign keys below).
  const projectId = `prj_${project.slug.replaceAll('-', '_')}`
  statements.push(`DELETE FROM media_usage WHERE entity = 'project' AND entity_id IN (SELECT id FROM projects WHERE slug = ${quote(project.slug)});`)
  statements.push(`DELETE FROM project_category_map WHERE project_id IN (SELECT id FROM projects WHERE slug = ${quote(project.slug)});`)
  statements.push(`DELETE FROM projects WHERE slug = ${quote(project.slug)};`)
  statements.push(`INSERT INTO projects (id, ${columns.join(', ')}, published_at, created_at, updated_at)
    VALUES (${quote(projectId)}, ${columns.map((column) => quote(project[column])).join(', ')}, ${publishedAt}, datetime('now'), datetime('now'));`)

  statements.push(`DELETE FROM project_category_map WHERE project_id = (SELECT id FROM projects WHERE slug = ${quote(project.slug)});`)
  for (const slug of project.categories) {
    statements.push(`INSERT OR IGNORE INTO project_category_map (project_id, category_id)
      SELECT p.id, c.id FROM projects p, project_categories c
      WHERE p.slug = ${quote(project.slug)} AND c.slug = ${quote(slug)};`)
  }

  // media_usage for every ImageRef the project contains.
  const refs = [
    project.card_image,
    project.hero_image,
    project.feature_image,
    ...(project.gallery ? JSON.parse(project.gallery) : []),
    project.og_image,
  ].filter((value) => typeof value === 'object' && value !== null)
  statements.push(`DELETE FROM media_usage WHERE entity = 'project' AND entity_id = (SELECT id FROM projects WHERE slug = ${quote(project.slug)});`)
  for (const mediaRef of refs) {
    statements.push(`INSERT OR IGNORE INTO media_usage (media_id, entity, entity_id)
      SELECT ${quote(mediaRef.mediaId)}, 'project', id FROM projects WHERE slug = ${quote(project.slug)};`)
  }
}

statements.push("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'content_version';")

const sqlPath = join(temp, 'seed-projects.sql')
writeFileSync(sqlPath, `${statements.join('\n\n')}\n`)

/* ----------------------------------------------------------------- execute -- */

function wrangler(args) {
  const bin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(
      `wrangler ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
  }
  return result.stdout
}

console.log(`Seeding ${categories.length} categories, ${allImages.length} media, ${projects.length} projects`)
console.log(`Mode: ${remote ? 'remote' : 'local'}  Site: ${siteRoot}`)
if (eventotronStatus === 'draft') {
  console.log(
    'Eventotron has placeholder images, so it is seeded as a DRAFT (spec §10: never publish placeholders).\n' +
      'Add real files to the site repo (eventotron-hero.jpg, eventotron-feature.jpg, eventotron-1..6.jpg)\n' +
      'and re-run, or pass --publish-placeholders to force publishing.',
  )
}

for (const row of allImages) {
  const args = [
    'r2',
    'object',
    'put',
    `${bucket}/${row.r2Key}`,
    '--file',
    row.path,
    '--content-type',
    row.mime,
    '--cache-control',
    'public, max-age=31536000, immutable',
    remote ? '--remote' : '--local',
  ]
  if (!remote) args.push('--persist-to', persistTo)
  wrangler(args)
  console.log(`  uploaded ${row.r2Key}`)
}

const executeArgs = [
  'd1',
  'execute',
  'DB',
  remote ? '--remote' : '--local',
  '--config',
  configPath,
  '--file',
  sqlPath,
  '--yes',
]
if (!remote) executeArgs.push('--persist-to', persistTo)
console.log(wrangler(executeArgs).trim())

rmSync(temp, { recursive: true, force: true })
console.log('Projects seed complete.')
