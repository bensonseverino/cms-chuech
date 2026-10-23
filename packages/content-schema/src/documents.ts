import { z } from 'zod'
import { requiredPaths, type FieldDef } from './fields'
import {
  MAX_ARRAY,
  MAX_STRING,
  inlineText,
  linkTarget,
  markdownBody,
  mediaRefOptional,
  seoBlock,
  titleTemplate,
} from './primitives'
import { draftObject } from './shape'

/*
 * Documents — the singletons and pages (spec §2.1). Field order in each catalog
 * matches the order the editor shows them, and matches the order the site
 * reads them, so a reviewer can read one top to bottom.
 *
 * Every field is optional at draft level (`draftObject` + a group per section);
 * `xxxRequired` lists what publishing demands, derived from the catalog so the
 * editor's asterisks and the publish gate cannot drift.
 */

// --- Shared fragments -------------------------------------------------------

/** A labelled link inside a document. */
const cta = draftObject({ label: inlineText(200), to: linkTarget })

/** A video with its poster frame. The site plays the poster until in view. */
const mediaPair = draftObject({ video: mediaRefOptional, poster: mediaRefOptional })

/** An inline paragraph with a required question (FAQ rows). */
const faqItem = z.object({
  q: inlineText(),
  a: inlineText(),
})

// --- _site ------------------------------------------------------------------

export const siteDocSchema = draftObject({
  companyName: inlineText(200),
  email: inlineText(320),
  phone: inlineText(60),
  address: inlineText(300),
  regNo: inlineText(60),
  vatNo: inlineText(60),
  defaultSeo: draftObject({
    titleTemplate,
    description: inlineText(160),
    ogImage: mediaRefOptional,
  }),
  social: z
    .array(draftObject({ label: inlineText(60), to: linkTarget }))
    .max(MAX_ARRAY),
})

export type SiteDoc = z.infer<typeof siteDocSchema>

export const siteFields: FieldDef[] = [
  { path: 'companyName', type: 'text', label: 'Company name', required: true, max: 200 },
  { path: 'email', type: 'text', label: 'Email', required: true },
  { path: 'phone', type: 'text', label: 'Phone', required: true },
  { path: 'address', type: 'text', label: 'Address' },
  { path: 'regNo', type: 'text', label: 'Registration number' },
  { path: 'vatNo', type: 'text', label: 'VAT number' },
  {
    path: 'defaultSeo',
    type: 'group',
    label: 'Default SEO',
    help: 'Used when a page does not set its own.',
    fields: [
      { path: 'titleTemplate', type: 'text', label: 'Title template', required: true, max: 70,
        help: 'Include %s where the page title goes.' },
      { path: 'description', type: 'textarea', label: 'Default description', max: 160 },
      { path: 'ogImage', type: 'media', label: 'Default social image', accept: 'image' },
    ],
  },
  { path: 'social', type: 'repeater', label: 'Social links', itemLabel: 'Link',
    fields: [
      { path: 'label', type: 'text', label: 'Label', required: true },
      { path: 'to', type: 'link', label: 'Link', required: true },
    ] },
]
export const siteRequired = requiredPaths(siteFields)

// --- _navigation ------------------------------------------------------------

const navItem = z.object({
  label: inlineText(80),
  to: linkTarget,
  children: z.array(draftObject({ label: inlineText(80), to: linkTarget })).max(MAX_ARRAY).optional(),
})

export const navigationDocSchema = draftObject({
  items: z.array(navItem).max(MAX_ARRAY),
  cta,
})

export type NavigationDoc = z.infer<typeof navigationDocSchema>

export const navigationFields: FieldDef[] = [
  { path: 'items', type: 'repeater', label: 'Menu items', itemLabel: 'Item', max: 20,
    fields: [
      { path: 'label', type: 'text', label: 'Label', required: true },
      { path: 'to', type: 'link', label: 'Link', required: true },
      { path: 'children', type: 'repeater', label: 'Dropdown', itemLabel: 'Link', max: 20,
        fields: [
          { path: 'label', type: 'text', label: 'Label', required: true },
          { path: 'to', type: 'link', label: 'Link', required: true },
        ] },
    ] },
  { path: 'cta', type: 'group', label: 'Header call to action', fields: [
    { path: 'label', type: 'text', label: 'Label' },
    { path: 'to', type: 'link', label: 'Link' },
  ] },
]
export const navigationRequired = requiredPaths(navigationFields)

// --- _footer ----------------------------------------------------------------

export const footerDocSchema = draftObject({
  statement: inlineText(MAX_STRING),
  links: z.array(draftObject({ label: inlineText(80), to: linkTarget })).max(MAX_ARRAY),
  ctaLabel: inlineText(80),
  ctaTo: linkTarget,
  /** The copyright line above the hairline. */
  legal: inlineText(200),
})

export type FooterDoc = z.infer<typeof footerDocSchema>

export const footerFields: FieldDef[] = [
  { path: 'statement', type: 'inline', label: 'Statement', required: true,
    help: 'Inline markup: **bold**, ==highlight==, [text](/path).' },
  { path: 'links', type: 'repeater', label: 'Footer links', itemLabel: 'Link', max: 20,
    fields: [
      { path: 'label', type: 'text', label: 'Label', required: true },
      { path: 'to', type: 'link', label: 'Link', required: true },
    ] },
  { path: 'ctaLabel', type: 'text', label: 'Button label' },
  { path: 'ctaTo', type: 'link', label: 'Button link' },
  { path: 'legal', type: 'text', label: 'Copyright line' },
]
export const footerRequired = requiredPaths(footerFields)

// --- _home ------------------------------------------------------------------

export const homeDocSchema = draftObject({
  seo: seoBlock,
  hero: draftObject({
    pills: z.tuple([inlineText(120), inlineText(120)]),
    media: z.tuple([mediaPair, mediaPair, mediaPair]),
    description: inlineText(),
  }),
  introStatement: draftObject({
    text: inlineText(),
    cta,
  }),
  /** The "Our Services" band on the Home page (the rows come from `services`). */
  services: draftObject({
    heading: inlineText(200),
  }),
  latestWork: draftObject({
    heading: inlineText(200),
    intro: inlineText(),
    // Four featured cards at most; `column` is where the card sits on the
    // two-column Home panel (DOM order is right column first).
    featuredProjects: z
      .array(draftObject({ slug: inlineText(80), column: z.enum(['left', 'right']) }))
      .max(4),
    viewAll: cta,
  }),
  stats: draftObject({
    marquee: z.array(inlineText(200)).max(MAX_ARRAY),
    pills: z.tuple([inlineText(120), inlineText(120)]),
    frames: z.tuple([mediaPair, mediaPair, mediaPair]),
    ctaText: inlineText(300),
    ctaLabel: inlineText(80),
    ctaTo: linkTarget,
  }),
  insights: draftObject({
    heading: inlineText(200),
    articles: z.array(inlineText(80)).max(MAX_ARRAY),
    viewAll: cta,
  }),
  caseStudy: draftObject({
    heading: inlineText(300),
    stat: inlineText(40),
    statLabel: inlineText(120),
    blurb: inlineText(),
    cta,
    testimonial: draftObject({
      quote: inlineText(),
      name: inlineText(120),
      company: inlineText(120),
    }),
  }),
  faq: draftObject({
    heading: inlineText(200),
    intro: inlineText(),
    items: z.array(faqItem).max(MAX_ARRAY),
  }),
  /**
   * Founder block. Not in the spec's §2.1 home list, but the site renders it on
   * the home page today (see docs/cms-inventory.md), so it must be editable for
   * section 8.3 parity. Additive, not a substitution.
   */
  founder: draftObject({
    heading: inlineText(300),
    paragraphs: z.array(inlineText()).max(MAX_ARRAY),
    cta,
  }),
})

export type HomeDoc = z.infer<typeof homeDocSchema>

export const homeFields: FieldDef[] = [
  { path: 'seo', type: 'group', label: 'SEO', fields: seoFields() },
  { path: 'hero', type: 'group', label: 'Hero', fields: [
    { path: 'pills', type: 'list', of: 'text', label: 'Pills', min: 2, max: 2, help: 'Exactly two.' },
    { path: 'media', type: 'repeater', label: 'Hero media', itemLabel: 'Video', max: 3,
      help: 'Three videos, each with its poster frame.',
      fields: [
        { path: 'video', type: 'media', label: 'Video', accept: 'video' },
        { path: 'poster', type: 'media', label: 'Poster', accept: 'image' },
      ] },
    { path: 'description', type: 'inline', label: 'Description', required: true },
  ] },
  { path: 'introStatement', type: 'group', label: 'Intro statement', fields: [
    { path: 'text', type: 'inline', label: 'Statement', required: true },
    { path: 'cta', type: 'group', label: 'Button', fields: [
      { path: 'label', type: 'text', label: 'Label' },
      { path: 'to', type: 'link', label: 'Link' },
    ] },
  ] },
  { path: 'latestWork', type: 'group', label: 'Latest work', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'intro', type: 'inline', label: 'Intro' },
    { path: 'featuredProjects', type: 'repeater', label: 'Featured projects', itemLabel: 'Project', max: 4,
      fields: [
        { path: 'slug', type: 'reference', label: 'Project', collection: 'projects', required: true },
        { path: 'column', type: 'select', label: 'Column', required: true,
          options: [
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ] },
      ] },
    { path: 'viewAll', type: 'group', label: 'View all link', fields: [
      { path: 'label', type: 'text', label: 'Label' },
      { path: 'to', type: 'link', label: 'Link' },
    ] },
  ] },
  { path: 'services', type: 'group', label: 'Services section', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
  ] },
  { path: 'stats', type: 'group', label: 'Experience section', fields: [
    { path: 'marquee', type: 'list', of: 'text', label: 'Marquee phrases', max: 10 },
    { path: 'pills', type: 'list', of: 'text', label: 'Pills', min: 2, max: 2 },
    { path: 'frames', type: 'repeater', label: 'Frames', itemLabel: 'Video', max: 3,
      help: 'Three videos, each with its poster frame.',
      fields: [
        { path: 'video', type: 'media', label: 'Video', accept: 'video' },
        { path: 'poster', type: 'media', label: 'Poster', accept: 'image' },
      ] },
    { path: 'ctaText', type: 'text', label: 'Call-to-action text' },
    { path: 'ctaLabel', type: 'text', label: 'Button label' },
    { path: 'ctaTo', type: 'link', label: 'Button link' },
  ] },
  { path: 'insights', type: 'group', label: 'Insights', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'articles', type: 'list', of: 'reference', collection: 'articles', label: 'Articles', max: 12 },
    { path: 'viewAll', type: 'group', label: 'View all link', fields: [
      { path: 'label', type: 'text', label: 'Label' },
      { path: 'to', type: 'link', label: 'Link' },
    ] },
  ] },
  { path: 'caseStudy', type: 'group', label: 'Case study', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'stat', type: 'text', label: 'Statistic' },
    { path: 'statLabel', type: 'text', label: 'Statistic label' },
    { path: 'blurb', type: 'inline', label: 'Blurb' },
    { path: 'cta', type: 'group', label: 'Button', fields: [
      { path: 'label', type: 'text', label: 'Label' },
      { path: 'to', type: 'link', label: 'Link' },
    ] },
    { path: 'testimonial', type: 'group', label: 'Testimonial', fields: [
      { path: 'quote', type: 'inline', label: 'Quote' },
      { path: 'name', type: 'text', label: 'Name' },
      { path: 'company', type: 'text', label: 'Company' },
    ] },
  ] },
  { path: 'faq', type: 'group', label: 'FAQ', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'intro', type: 'inline', label: 'Intro' },
    { path: 'items', type: 'repeater', label: 'Questions', itemLabel: 'Question',
      fields: [
        { path: 'q', type: 'text', label: 'Question', required: true },
        { path: 'a', type: 'inline', label: 'Answer', required: true },
      ] },
  ] },
  { path: 'founder', type: 'group', label: 'Founder block', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'paragraphs', type: 'list', of: 'text', label: 'Paragraphs', max: 10 },
    { path: 'cta', type: 'group', label: 'Button', fields: [
      { path: 'label', type: 'text', label: 'Label' },
      { path: 'to', type: 'link', label: 'Link' },
    ] },
  ] },
]
export const homeRequired = requiredPaths(homeFields)

// --- _services (the /services index) ---------------------------------------

export const servicesIndexDocSchema = draftObject({
  seo: seoBlock,
  hero: draftObject({
    label: inlineText(80),
    title: inlineText(200),
    pills: z.tuple([inlineText(120), inlineText(120)]),
    image: mediaRefOptional,
    description: inlineText(),
  }),
  introStatement: draftObject({ text: inlineText() }),
  latestWorkIntro: inlineText(),
})

export type ServicesIndexDoc = z.infer<typeof servicesIndexDocSchema>

export const servicesIndexFields: FieldDef[] = [
  { path: 'seo', type: 'group', label: 'SEO', fields: seoFields() },
  { path: 'hero', type: 'group', label: 'Page hero', fields: [
    { path: 'label', type: 'text', label: 'Eyebrow label' },
    { path: 'title', type: 'text', label: 'Title', required: true },
    { path: 'pills', type: 'list', of: 'text', label: 'Pills', min: 2, max: 2 },
    { path: 'image', type: 'media', label: 'Hero image', accept: 'image' },
    { path: 'description', type: 'inline', label: 'Description' },
  ] },
  { path: 'introStatement', type: 'group', label: 'Intro statement', fields: [
    { path: 'text', type: 'inline', label: 'Statement', required: true,
      help: 'Highlights are ==marked like this== inside the text.' },
  ] },
  { path: 'latestWorkIntro', type: 'inline', label: 'Latest work intro' },
]
export const servicesIndexRequired = requiredPaths(servicesIndexFields)

// --- _work (the /work index) ------------------------------------------------

export const workIndexDocSchema = draftObject({
  seo: seoBlock,
  hero: draftObject({
    label: inlineText(80),
    title: inlineText(200),
    pills: z.tuple([inlineText(120), inlineText(120)]),
    image: mediaRefOptional,
    description: inlineText(),
  }),
  pageSize: z.number().int().min(1).max(50),
})

export type WorkIndexDoc = z.infer<typeof workIndexDocSchema>

export const workIndexFields: FieldDef[] = [
  { path: 'seo', type: 'group', label: 'SEO', fields: seoFields() },
  { path: 'hero', type: 'group', label: 'Page hero', fields: [
    { path: 'label', type: 'text', label: 'Eyebrow label' },
    { path: 'title', type: 'text', label: 'Title', required: true },
    { path: 'pills', type: 'list', of: 'text', label: 'Pills', min: 2, max: 2 },
    { path: 'image', type: 'media', label: 'Hero image', accept: 'image' },
    { path: 'description', type: 'inline', label: 'Description' },
  ] },
  { path: 'pageSize', type: 'number', label: 'Projects per page', min: 1, max: 50,
    help: 'The /work grid page size. Default 13.' },
]
export const workIndexRequired = requiredPaths(workIndexFields)

// --- service_page -----------------------------------------------------------

export const servicePageDocSchema = draftObject({
  seo: seoBlock,
  hero: draftObject({
    badge: inlineText(80),
    title: inlineText(200),
    chips: z.array(inlineText(80)).max(8),
    intro: inlineText(),
    formHeading: inlineText(200),
    formHighlight: inlineText(120),
    submitLabel: inlineText(60),
  }),
  feature: draftObject({
    heading: inlineText(200),
    lead: inlineText(),
    checklist: z.array(inlineText(300)).max(MAX_ARRAY),
    body: inlineText(),
    ctaLabel: inlineText(80),
    ctaTo: linkTarget,
    image: mediaRefOptional,
  }),
  projects: draftObject({
    heading: inlineText(200),
    /** The service tag the carousel filters projects by. */
    tag: inlineText(80),
    /**
     * An explicit selection and order by slug. Additive to the spec: the live
     * service pages curate their own carousels, and spec §8.3 requires the same
     * projects in the same order, which a tag filter alone cannot reproduce.
     * When present it wins over `tag`.
     */
    slugs: z.array(inlineText(80)).max(50),
    limit: z.number().int().min(1).max(50),
  }),
  pillars: draftObject({
    items: z.array(draftObject({ title: inlineText(120), body: inlineText() })).max(MAX_ARRAY),
    ctaLabel: inlineText(80),
    ctaTo: linkTarget,
  }),
  why: draftObject({
    heading: inlineText(200),
    body: inlineText(),
    ctaLabel: inlineText(80),
    ctaTo: linkTarget,
    image: mediaRefOptional,
    callbackSubmitLabel: inlineText(60),
  }),
  faq: draftObject({
    items: z.array(faqItem).max(MAX_ARRAY),
  }),
})

export type ServicePageDoc = z.infer<typeof servicePageDocSchema>

export const servicePageFields: FieldDef[] = [
  { path: 'seo', type: 'group', label: 'SEO', fields: seoFields() },
  { path: 'hero', type: 'group', label: 'Hero', fields: [
    { path: 'badge', type: 'text', label: 'Badge', required: true },
    { path: 'title', type: 'text', label: 'Title', required: true },
    { path: 'chips', type: 'list', of: 'text', label: 'Chips', max: 8 },
    { path: 'intro', type: 'inline', label: 'Intro' },
    { path: 'formHeading', type: 'text', label: 'Form heading' },
    { path: 'formHighlight', type: 'text', label: 'Form highlight' },
    { path: 'submitLabel', type: 'text', label: 'Submit label' },
  ] },
  { path: 'feature', type: 'group', label: 'Feature panel', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'lead', type: 'inline', label: 'Lead' },
    { path: 'checklist', type: 'list', of: 'text', label: 'Checklist', max: 20 },
    { path: 'body', type: 'inline', label: 'Body' },
    { path: 'ctaLabel', type: 'text', label: 'Button label' },
    { path: 'ctaTo', type: 'link', label: 'Button link' },
    { path: 'image', type: 'media', label: 'Image', accept: 'image' },
  ] },
  { path: 'projects', type: 'group', label: 'Projects carousel', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'tag', type: 'text', label: 'Service tag', help: 'Filters projects whose services include this tag.' },
    { path: 'slugs', type: 'list', of: 'reference', collection: 'projects', label: 'Curated projects',
      max: 50, help: 'Optional. When set, these projects are shown in this order and the tag is ignored.' },
    { path: 'limit', type: 'number', label: 'Maximum projects', min: 1, max: 50 },
  ] },
  { path: 'pillars', type: 'group', label: 'Pillars', fields: [
    { path: 'items', type: 'repeater', label: 'Pillars', itemLabel: 'Pillar',
      fields: [
        { path: 'title', type: 'text', label: 'Title', required: true },
        { path: 'body', type: 'inline', label: 'Body', required: true },
      ] },
    { path: 'ctaLabel', type: 'text', label: 'Button label' },
    { path: 'ctaTo', type: 'link', label: 'Button link' },
  ] },
  { path: 'why', type: 'group', label: 'Why us / callback', fields: [
    { path: 'heading', type: 'text', label: 'Heading' },
    { path: 'body', type: 'inline', label: 'Body' },
    { path: 'ctaLabel', type: 'text', label: 'Button label' },
    { path: 'ctaTo', type: 'link', label: 'Button link' },
    { path: 'image', type: 'media', label: 'Image', accept: 'image' },
    { path: 'callbackSubmitLabel', type: 'text', label: 'Callback submit label' },
  ] },
  { path: 'faq', type: 'group', label: 'FAQ', fields: [
    { path: 'items', type: 'repeater', label: 'Questions', itemLabel: 'Question',
      fields: [
        { path: 'q', type: 'text', label: 'Question', required: true },
        { path: 'a', type: 'inline', label: 'Answer', required: true },
      ] },
  ] },
]
export const servicePageRequired = requiredPaths(servicePageFields)

// --- page (generic: Privacy, Terms, About, Culture) -------------------------

export const pageDocSchema = draftObject({
  seo: seoBlock,
  title: inlineText(200),
  body: markdownBody,
})

export type PageDoc = z.infer<typeof pageDocSchema>

export const pageFields: FieldDef[] = [
  { path: 'seo', type: 'group', label: 'SEO', fields: seoFields() },
  { path: 'title', type: 'text', label: 'Title', required: true, max: 200 },
  { path: 'body', type: 'markdown', label: 'Body', required: true,
    help: 'Markdown. Sanitised to HTML when the page is published.' },
]
export const pageRequired = requiredPaths(pageFields)

// --- Shared SEO catalog -----------------------------------------------------

/** The SEO group, in the same order for every record that has one. */
export function seoFields(): FieldDef[] {
  return [
    { path: 'title', type: 'text', label: 'Title', max: 70, help: 'Up to 70 characters.' },
    { path: 'description', type: 'textarea', label: 'Description', max: 160,
      help: 'Up to 160 characters.' },
    { path: 'image', type: 'media', label: 'Social image', accept: 'image' },
  ]
}

/** Re-exported so the registry can build a "new page from template" payload. */
export const DOCUMENT_TEMPLATES = {
  page: { type: 'page', title: 'New page', data: { title: 'New page', body: '' } },
  service_page: {
    type: 'service_page',
    title: 'New service page',
    data: { hero: { badge: 'Service', title: 'New service page' } },
  },
} as const
