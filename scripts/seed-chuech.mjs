import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

/*
 * Seed the Chuech Studio content into D1 and the shared R2 bucket.
 *
 * The canonical copy still lives in the public site repo
 * (`website/my-project/src/content`). This script bundles that content with the
 * CMS schemas, maps the site's asset slots and rich-text fragments into the CMS
 * record shapes, validates every record at PUBLISH level, then writes the
 * result through Wrangler.
 *
 * Usage:
 *   npm run seed:chuech                 # local D1 + local R2
 *   npm run seed:chuech -- --remote     # production resources in admin/wrangler.toml
 *   CHUECH_SITE_ROOT=... npm run seed:chuech
 *
 * The seed is idempotent for the records it owns: documents are upserted by
 * slug, entries by (collection, slug) or id, and media by id. It deliberately
 * leaves other records (manual pages, submissions, users, forms) alone.
 */

const remote = process.argv.includes('--remote')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const siteRoot =
  process.env.CHUECH_SITE_ROOT ??
  resolve(root, '..', '..', 'website', 'my-project', 'src')
const contentRoot = join(siteRoot, 'content')
const assetsRoot = join(siteRoot, 'assets', 'marino')
const configPath = join(root, 'admin', 'wrangler.toml')
const persistTo = join(root, '.wrangler', 'state')
const temp = mkdtempSync(join(tmpdir(), 'chuech-seed-'))

if (!existsSync(contentRoot)) {
  console.error(`Site content not found at ${contentRoot}`)
  console.error('Set CHUECH_SITE_ROOT to the public site src directory.')
  process.exit(1)
}

const config = readFileSync(configPath, 'utf8')
const bucket = /bucket_name\s*=\s*"([^"]+)"/.exec(config)?.[1]
if (!bucket) throw new Error('Could not read bucket_name from admin/wrangler.toml')

const bundlePath = join(temp, 'content.mjs')
await build({
  stdin: {
    contents: `
      export * as schema from ${JSON.stringify(join(root, 'packages/content-schema/src/index.ts'))}
      export * as home from ${JSON.stringify(join(contentRoot, 'home.ts'))}
      export * as projects from ${JSON.stringify(join(contentRoot, 'projects.ts'))}
      export * as services from ${JSON.stringify(join(contentRoot, 'services.ts'))}
      export * as webDesign from ${JSON.stringify(join(contentRoot, 'services/web-design.ts'))}
      export * as branding from ${JSON.stringify(join(contentRoot, 'services/branding.ts'))}
      export * as seo from ${JSON.stringify(join(contentRoot, 'services/seo.ts'))}
    `,
    resolveDir: root,
    sourcefile: 'chuech-seed-content.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'silent',
})

const { schema, home, projects, services, webDesign, branding, seo } = await import(
  pathToFileURL(bundlePath).href
)

/* ------------------------------------------------------------------ media -- */

const SEED_TIME = '01JSEED'
const seedId = (offset) => `${SEED_TIME}${String(offset).padStart(19, '0')}`

const assets = [
  ['work-ph', 'work-ph.svg', 'Project card placeholder', 'project'],
  ['hero-team', 'hero-team.svg', 'The Chuech Studio team placeholder', 'team'],
  ['article-ph', 'article-ph.svg', 'Article placeholder', 'article'],
  ['service-branding', 'service-branding.svg', 'Branding service placeholder', 'service'],
  ['service-web-design', 'service-web-design.svg', 'Web Design service placeholder', 'service'],
  ['service-seo', 'service-seo.svg', 'SEO service placeholder', 'service'],
  ['service-ppc', 'service-ppc.svg', 'PPC service placeholder', 'service'],
  ['service-video', 'service-video.svg', 'Video service placeholder', 'service'],
  ['blackbird', 'blackbird.svg', 'Blackbird case study placeholder', 'project'],
  ['blackbird-logo', 'blackbird-logo.svg', 'Blackbird logo placeholder', 'logo'],
  ['stats-1', 'stats-1.svg', 'Experience section frame placeholder', 'experience'],
  ['stats-2', 'stats-2.svg', 'Experience section frame placeholder', 'experience'],
  ['stats-3', 'stats-3.svg', 'Experience section frame placeholder', 'experience'],
  ['chuech-logo', 'chuech-logo2.svg', 'Chuech Studio logo', 'logo'],
  ['contact-thumb', 'contact-thumb.svg', 'Contact thumbnail placeholder', 'contact'],
  ['hero-terminal', 'hero-terminal.svg', 'Terminal hero placeholder', 'team'],
]

const clients = [
  'emap',
  'WR Partners',
  'Hard Rock Cafe',
  'ISTOBAL',
  'LEONARDO Hotels',
  'HITACHI',
  'Haines Watts',
  'VISLINK',
  'AP NUT',
]

function xml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function clientLogo(name) {
  const size = name.length > 13 ? 38 : name.length > 10 ? 44 : 52
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 120" role="img" aria-label="${xml(name)} logo placeholder">
  <text x="300" y="77" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700" letter-spacing="1" fill="#111111">${xml(name.toUpperCase())}</text>
</svg>
`
}

function dimensions(svg) {
  const viewBox = /viewBox=["']([^"']+)["']/.exec(svg)
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) }
    }
  }
  return { width: null, height: null }
}

const media = []
let mediaOffset = 100

for (const [key, filename, alt, tag] of assets) {
  const path = join(assetsRoot, filename)
  if (!existsSync(path)) throw new Error(`Missing site asset: ${path}`)
  const body = readFileSync(path)
  const text = body.toString('utf8')
  const id = `med_${seedId(mediaOffset++)}`
  const r2Key = `uploads/2026/10/chuech-seed/${filename}`
  media.push({
    id,
    key,
    r2Key,
    kind: 'svg',
    mime: 'image/svg+xml',
    size: body.length,
    ...dimensions(text),
    filename,
    alt,
    tags: ['seed', tag],
    body,
    localPath: path,
  })
}

for (const name of clients) {
  const slug = name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const filename = `${slug}.svg`
  const body = Buffer.from(clientLogo(name))
  const localPath = join(temp, filename)
  writeFileSync(localPath, body)
  const id = `med_${seedId(mediaOffset++)}`
  media.push({
    id,
    key: `client-${slug}`,
    r2Key: `uploads/2026/10/chuech-seed/clients/${filename}`,
    kind: 'svg',
    mime: 'image/svg+xml',
    size: body.length,
    ...dimensions(body.toString('utf8')),
    filename,
    alt: `${name} logo`,
    tags: ['seed', 'client', 'logo'],
    body,
    localPath,
  })
}

const byKey = new Map(media.map((row) => [row.key, row]))
const byFilename = new Map(media.map((row) => [row.filename, row]))

const slotMap = {
  'work-ph': 'work-ph',
  'work-latakoo': 'work-ph',
  'work-vislink': 'work-ph',
  'work-wr-partners': 'work-ph',
  'work-office-insight': 'work-ph',
  'work-eventotron': 'work-ph',
  'work-portswigger': 'work-ph',
  'work-blackbird': 'work-ph',
  'work-star-laundry': 'work-ph',
  'work-a1s-group': 'work-ph',
  'work-confirm-testing': 'work-ph',
  'work-modern-garden-rooms': 'work-ph',
  'work-spatial': 'work-ph',
  'work-ice-signs': 'work-ph',
  'work-hero': 'hero-team',
  'web-design-feature': 'hero-team',
  'web-design-why': 'hero-team',
  'seo-feature': 'hero-team',
  'seo-why': 'hero-team',
  'branding-feature': 'hero-team',
  'branding-why': 'hero-team',
  'services-hero': 'hero-team',
  'service-branding': 'service-branding',
  'service-web-design': 'service-web-design',
  'service-seo': 'service-seo',
  'service-ppc': 'service-ppc',
  'service-video': 'service-video',
  'article-ph': 'article-ph',
  blackbird: 'blackbird',
  'blackbird-logo': 'blackbird-logo',
  'stats-1': 'stats-1',
  'stats-2': 'stats-2',
  'stats-3': 'stats-3',
}

function mediaId(slot) {
  const key = slotMap[slot] ?? slot
  const row = byKey.get(key)
  if (!row) throw new Error(`No seeded media for slot: ${slot}`)
  return row.id
}

function ref(slot, alt) {
  const id = mediaId(slot)
  return alt ? { mediaId: id, alt } : { mediaId: id }
}

/* ---------------------------------------------------------------- helpers -- */

function rich(segments) {
  return segments
    .map((segment) =>
      typeof segment === 'string' ? segment : `[${segment.label}](${segment.href})`,
    )
    .join('')
}

function highlighted(text, phrases) {
  let value = text
  for (const phrase of phrases) value = value.split(phrase).join(`==${phrase}==`)
  return value
}

function focusPoint(value) {
  if (!value) return undefined
  const parts = value.trim().split(/\s+/)
  const axis = (part, fallback) => {
    if (!part) return fallback
    if (part === 'center') return 0.5
    if (part === 'left' || part === 'top') return 0
    if (part === 'right' || part === 'bottom') return 1
    if (part.endsWith('%')) {
      const percent = Number.parseFloat(part)
      if (Number.isFinite(percent)) return Math.min(1, Math.max(0, percent / 100))
    }
    return fallback
  }
  return { x: axis(parts[0], 0.5), y: axis(parts[1], 0.5) }
}

function slugFromHref(href) {
  return href.replace(/^\/+|\/+$/g, '').split('/').pop()
}

const HOME_SEO = {
  title: 'Chuech Studio | Web Design Agency Nairobi',
  description:
    'Chuech Studio is a Nairobi web design agency creating purposeful websites that make brands clearer, stronger, and easier to choose.',
  image: ref('work-ph', 'Chuech Studio project placeholder'),
}

const HERO_DESCRIPTION =
  'We design and build **purposeful websites** that make brands **clearer, stronger, and easier to choose**, backed by a team that cares about the details.'

/* -------------------------------------------------------------- documents -- */

const documents = []

documents.push({
  slug: '_site',
  type: 'site',
  title: 'Site settings',
  data: {
    companyName: 'Chuech Studio',
    email: 'hello@chuechstudio.co.ke',
    phone: '+254 117 954 929',
    address: 'Nairobi, Kenya',
    defaultSeo: {
      titleTemplate: '%s | Chuech Studio',
      description: HOME_SEO.description,
      ogImage: ref('work-ph', 'Chuech Studio project placeholder'),
    },
    social: [],
  },
})

documents.push({
  slug: '_navigation',
  type: 'navigation',
  title: 'Navigation',
  data: {
    items: [
      {
        label: 'Services',
        to: '/services',
        children: services.PAGE_SERVICES.map((service) => ({
          label: service.title,
          to: `/${service.slug}`,
        })),
      },
      { label: 'Work', to: '/work' },
      {
        label: 'About',
        to: '/about',
        children: [
          { label: 'About Us', to: '/about' },
          { label: 'Culture', to: '/culture' },
          { label: 'Testimonials', to: '/testimonials' },
        ],
      },
      { label: 'Blog', to: '/blog' },
    ],
    cta: { label: 'Contact', to: '/contact' },
  },
})

documents.push({
  slug: '_footer',
  type: 'footer',
  title: 'Footer',
  data: {
    statement: rich(home.FOOTER.statement),
    links: home.FOOTER.links.map((link) => ({ label: link.label, to: link.href })),
    ctaLabel: home.FOOTER.getInTouch,
    ctaTo: home.FOOTER.contact.href,
    legal: home.FOOTER.legal,
  },
})

documents.push({
  slug: '_home',
  type: 'home',
  title: 'Home',
  data: {
    seo: HOME_SEO,
    hero: {
      // The two floating pills inside the hero headline (the badge above it is
      // the site settings' company name and address).
      pills: ['Digital experiences', 'Thoughtfully made'],
      media: [
        { poster: ref('hero-team', 'The Chuech Studio team') },
        { poster: ref('hero-terminal', 'A terminal window from a Chuech Studio build') },
        { poster: ref('contact-thumb', 'Chuech Studio showreel thumbnail') },
      ],
      description: HERO_DESCRIPTION,
    },
    introStatement: {
      text: highlighted(
        'Our team is made up of bold creatives, sharp strategists, and technical pros who care deeply about what they do. No egos, no fluff – just hard work, smart thinking, and a genuine commitment to our clients’ success. We treat every brand and budget like it’s our own, always deliver on promises, and never lock clients into contracts.',
        [
          'bold',
          'creatives,',
          'sharp strategists,',
          'technical pros',
          'genuine commitment',
          'clients’ success.',
          'always deliver on promises,',
        ],
      ),
      cta: { label: home.INTRO.cta.label, to: home.INTRO.cta.href },
    },
    services: {
      heading: home.SERVICES_HEADING,
    },
    latestWork: {
      heading: home.LATEST_WORK.heading,
      intro: home.LATEST_WORK.intro,
      featuredProjects: projects.PROJECTS.filter((project) => project.column).map(
        (project) => ({ slug: project.slug, column: project.column }),
      ),
      viewAll: {
        label: home.LATEST_WORK.viewAll.label,
        to: home.LATEST_WORK.viewAll.href,
      },
    },
    stats: {
      // The desktop ticker uses all four; the mobile marquee uses the first two.
      marquee: [...home.TICKER_ITEMS],
      pills: [...home.EXPERIENCE_PILLS],
      frames: [
        { poster: ref('stats-1', 'Chuech Studio in focus') },
        { poster: ref('stats-2', 'Chuech Studio at work') },
        { poster: ref('stats-3', 'Chuech Studio project detail') },
      ],
      ctaText: home.BRIEF_CTA.text,
      ctaLabel: home.BRIEF_CTA.button.label,
      ctaTo: home.BRIEF_CTA.button.href,
    },
    insights: {
      heading: home.INSIGHTS.heading,
      articles: home.ARTICLES.map((article) => slugFromHref(article.href)),
      viewAll: {
        label: home.INSIGHTS.viewAll.label,
        to: home.INSIGHTS.viewAll.href,
      },
    },
    caseStudy: {
      heading: home.CASE_STUDY.heading,
      stat: home.CASE_STUDY.stat,
      statLabel: home.CASE_STUDY.statLabel,
      blurb: home.CASE_STUDY.blurb,
      cta: { label: home.CASE_STUDY.cta.label, to: home.CASE_STUDY.cta.href },
      testimonial: {
        quote: home.CASE_STUDY.testimonial.quote,
        name: home.CASE_STUDY.testimonial.name,
        company: home.CASE_STUDY.testimonial.company,
      },
    },
    faq: {
      heading: home.FAQ.heading,
      intro: home.FAQ.intro,
      items: home.FAQ_ITEMS.map((item) => ({
        q: item.question,
        a: rich(item.answer),
      })),
    },
    founder: {
      heading: home.FOUNDER_BLOCK.heading,
      paragraphs: home.FOUNDER_BLOCK.paragraphs.map((paragraph) => rich(paragraph)),
      cta: {
        label: home.FOUNDER_BLOCK.cta.label,
        to: home.FOUNDER_BLOCK.cta.href,
      },
    },
  },
})

documents.push({
  slug: '_services',
  type: 'services_index',
  title: 'Services page',
  data: {
    seo: {
      title: 'Services | Chuech Studio',
      description:
        'Explore branding, web design, SEO, PPC, and video services from Chuech Studio, a Nairobi-based digital partner.',
    },
    hero: {
      label: services.SERVICES_HERO.label,
      title: services.SERVICES_HERO.title,
      pills: [...services.SERVICES_HERO.pills],
      image: ref('services-hero', 'The Chuech Studio team'),
      description: HERO_DESCRIPTION,
    },
    introStatement: {
      text: highlighted(services.SERVICES_INTRO.text, services.SERVICES_INTRO.highlights),
    },
    latestWorkIntro: services.SERVICES_WORK_INTRO,
  },
})

documents.push({
  slug: '_work',
  type: 'work_index',
  title: 'Work page',
  data: {
    seo: {
      title: 'Work | Chuech Studio',
      description:
        'Selected branding, web design, SEO, PPC, and video projects from Chuech Studio in Nairobi, Kenya.',
    },
    hero: {
      label: 'Work',
      title: 'Latest Work',
      pills: ['Full-service agency', 'Trusted by ambitious brands'],
      image: ref('work-hero', 'The Chuech Studio team at work'),
      description: HERO_DESCRIPTION,
    },
    pageSize: projects.WORK_PAGE_SIZE,
  },
})

function servicePage({ slug, title, content, imageKey, imageAlt }) {
  const form = content.hero.form
  return {
    slug,
    type: 'service_page',
    title,
    data: {
      seo: {
        title: content.seo.title,
        description: content.seo.description,
        image: ref(imageKey, imageAlt),
      },
      hero: {
        badge: content.hero.label,
        title: content.hero.title,
        chips: [...content.hero.tags],
        intro: content.hero.intro,
        formHeading: form.heading,
        formHighlight: form.highlight,
        submitLabel: form.submitLabel,
      },
      feature: {
        heading: content.feature.heading,
        lead: content.feature.lead,
        checklist: [...content.feature.checklist],
        body: content.feature.body,
        ctaLabel: content.feature.cta.label,
        ctaTo: content.feature.cta.href,
        image: ref(content.feature.image, content.feature.imageAlt || imageAlt),
      },
      projects: {
        heading: content.projects.heading,
        tag: content.projects.tag,
        ...(content.projects.slugs ? { slugs: [...content.projects.slugs] } : {}),
        limit: content.projects.limit,
      },
      pillars: {
        items: content.pillars.items.map((item) => ({
          title: item.title,
          body: item.body,
        })),
        ctaLabel: content.pillars.cta.label,
        ctaTo: content.pillars.cta.href,
      },
      why: {
        heading: content.why.heading,
        body: content.why.body,
        ctaLabel: content.why.cta.label,
        ctaTo: content.why.cta.href,
        image: ref(content.why.image, content.why.imageAlt || imageAlt),
        callbackSubmitLabel: content.why.form.submitLabel,
      },
      faq: {
        items: content.faq.items.map((item) => ({ q: item.question, a: rich(item.answer) })),
      },
    },
  }
}

documents.push(
  servicePage({
    slug: 'branding',
    title: 'Branding',
    content: branding.BRANDING,
    imageKey: 'service-branding',
    imageAlt: 'Branding service placeholder',
  }),
  servicePage({
    slug: 'web-design',
    title: 'Web Design',
    content: webDesign.WEB_DESIGN,
    imageKey: 'service-web-design',
    imageAlt: 'Web Design service placeholder',
  }),
  servicePage({
    slug: 'seo-manchester',
    title: 'SEO',
    content: seo.SEO,
    imageKey: 'service-seo',
    imageAlt: 'SEO service placeholder',
  }),
)

/* ---------------------------------------------------------------- entries -- */

const servicePageSlugs = {
  branding: 'branding',
  'web-design': 'web-design',
  'seo-manchester': 'seo-manchester',
}

const entries = []

const serviceEntries = services.PAGE_SERVICES.map((service, index) => ({
  collection: 'services',
  slug: service.slug,
  sort: (index + 1) * 10,
  data: {
    slug: service.slug,
    title: service.title,
    description: service.description,
    keywords: service.keywords.map((keyword) =>
      typeof keyword === 'string' ? { label: keyword } : { label: keyword.label, to: keyword.href },
    ),
    image: ref(service.image, `${service.title} service placeholder`),
    sort: (index + 1) * 10,
    showOnHome: true,
    ...(servicePageSlugs[service.slug] ? { pageSlug: servicePageSlugs[service.slug] } : {}),
  },
}))
entries.push(...serviceEntries)

const projectEntries = projects.PROJECTS.filter(
  (project) => !project.slug.startsWith('todo-placeholder-'),
).map((project, index) => ({
  collection: 'projects',
  slug: project.slug,
  sort: (index + 1) * 10,
  data: {
    slug: project.slug,
    title: project.title,
    services: [...project.tags],
    image: ref(project.image, `${project.title} project placeholder`),
    ...(project.focus ? { cardFocus: focusPoint(project.focus) } : {}),
    featured: Boolean(project.column),
    sort: (index + 1) * 10,
  },
}))
entries.push(...projectEntries)

entries.push(
  ...home.TESTIMONIALS.map((testimonial, index) => ({
    collection: 'testimonials',
    slug: null,
    sort: (index + 1) * 10,
    data: {
      quote: testimonial.quote,
      author: testimonial.name,
      company: testimonial.company,
      sort: (index + 1) * 10,
    },
  })),
)

entries.push(
  ...clients.map((name, index) => {
    const key = media.find((row) => row.alt === `${name} logo`)?.key
    if (!key) throw new Error(`Missing logo for client ${name}`)
    const row = byKey.get(key)
    return {
      collection: 'clients',
      slug: null,
      sort: (index + 1) * 10,
      data: {
        name,
        logo: { mediaId: row.id, alt: `${name} logo` },
        sort: (index + 1) * 10,
      },
    }
  }),
)

const articleDates = {
  'July . 2026': '2026-07-01',
  'June . 2026': '2026-06-01',
  'May . 2026': '2026-05-01',
}

entries.push(
  ...home.ARTICLES.map((article, index) => {
    const slug = slugFromHref(article.href)
    return {
      collection: 'articles',
      slug,
      sort: (index + 1) * 10,
      data: {
        slug,
        title: article.title,
        date: articleDates[article.dateLabel] ?? '2026-07-01',
        excerpt: article.excerpt,
        categories: [...article.categories],
        image: ref(article.image, article.title),
        body: `${article.excerpt}\n\nMore detail from the Chuech Studio team will be added here.`,
        sort: (index + 1) * 10,
      },
    }
  }),
)

/* -------------------------------------------------------------- validation -- */

for (const doc of documents) {
  const definition = schema.DOCUMENTS[doc.type]
  const result = schema.validateRecord(definition.schema, definition.required, doc.data, 'publish')
  if (!result.ok) {
    throw new Error(
      `Document ${doc.slug} failed publish validation:\n${JSON.stringify(result.errors, null, 2)}`,
    )
  }
  doc.data = result.data
}

for (const [index, entry] of entries.entries()) {
  const definition = schema.COLLECTIONS[entry.collection]
  const result = schema.validateRecord(
    definition.schema,
    definition.required,
    entry.data,
    'publish',
  )
  if (!result.ok) {
    throw new Error(
      `Entry ${entry.collection}/${entry.slug ?? index} failed publish validation:\n${JSON.stringify(
        result.errors,
        null,
        2,
      )}`,
    )
  }
  entry.data = result.data
  entry.id = seedId(1000 + index)
}

/* --------------------------------------------------------------------- SQL -- */

function quote(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

const statements = ['PRAGMA foreign_keys = ON;']

for (const row of media) {
  statements.push(`INSERT INTO media (
    id, r2_key, kind, mime, size, width, height, duration, filename, alt,
    focus_x, focus_y, poster_media_id, tags, source, created_by, created_at
  ) VALUES (
    ${quote(row.id)}, ${quote(row.r2Key)}, ${quote(row.kind)}, ${quote(row.mime)},
    ${quote(row.size)}, ${quote(row.width)}, ${quote(row.height)}, NULL,
    ${quote(row.filename)}, ${quote(row.alt)}, NULL, NULL, NULL,
    ${quote(JSON.stringify(row.tags))}, 'seed', NULL, datetime('now')
  ) ON CONFLICT(id) DO UPDATE SET
    r2_key = excluded.r2_key,
    kind = excluded.kind,
    mime = excluded.mime,
    size = excluded.size,
    width = excluded.width,
    height = excluded.height,
    filename = excluded.filename,
    alt = excluded.alt,
    tags = excluded.tags,
    source = 'seed',
    deleted_at = NULL;`)
}

for (const doc of documents) {
  const json = JSON.stringify(doc.data)
  statements.push(`INSERT INTO documents (
    slug, type, title, status, data, published_data, version, published_at,
    updated_by, created_at, updated_at
  ) VALUES (
    ${quote(doc.slug)}, ${quote(doc.type)}, ${quote(doc.title)}, 'published',
    ${quote(json)}, ${quote(json)}, 1, datetime('now'), NULL, datetime('now'), datetime('now')
  ) ON CONFLICT(slug) DO UPDATE SET
    type = excluded.type,
    title = excluded.title,
    status = 'published',
    data = excluded.data,
    published_data = excluded.published_data,
    version = documents.version + 1,
    published_at = excluded.published_at,
    updated_at = excluded.updated_at;`)
}

for (const entry of entries) {
  const json = JSON.stringify(entry.data)
  const conflict =
    entry.slug === null
      ? 'ON CONFLICT(id) DO UPDATE SET'
      : 'ON CONFLICT(collection, slug) DO UPDATE SET'
  statements.push(`INSERT INTO entries (
    id, collection, slug, status, sort, data, published_data, version,
    published_at, created_by, updated_by, created_at, updated_at
  ) VALUES (
    ${quote(entry.id)}, ${quote(entry.collection)}, ${quote(entry.slug)}, 'published',
    ${quote(entry.sort)}, ${quote(json)}, ${quote(json)}, 1, datetime('now'),
    NULL, NULL, datetime('now'), datetime('now')
  ) ${conflict}
    sort = excluded.sort,
    status = 'published',
    data = excluded.data,
    published_data = excluded.published_data,
    version = entries.version + 1,
    published_at = excluded.published_at,
    updated_at = excluded.updated_at;`)
}

statements.push(
  "UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'content_version';",
)

const sqlPath = join(temp, 'seed.sql')
writeFileSync(sqlPath, `${statements.join('\n\n')}\n`)

/* ------------------------------------------------------------------ upload -- */

function wrangler(args) {
  // Run Wrangler's JS entry with the current Node binary. This avoids the
  // Windows .cmd shim (Node 22+ will not spawn it directly) and keeps paths
  // containing spaces intact.
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

console.log(`Seeding ${media.length} media, ${documents.length} documents, ${entries.length} entries`)
console.log(`Mode: ${remote ? 'remote' : 'local'}  Site: ${siteRoot}`)

for (const row of media) {
  const args = [
    'r2',
    'object',
    'put',
    `${bucket}/${row.r2Key}`,
    '--file',
    row.localPath,
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
const output = wrangler(executeArgs)
console.log(output.trim())

rmSync(temp, { recursive: true, force: true })
console.log('Chuech seed complete.')
