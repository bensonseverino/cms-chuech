export type Role = 'admin' | 'editor' | 'viewer'

export type User = {
  id: string
  email: string
  name: string | null
  role: Role
}

export type Capabilities = {
  publish: boolean
  editContent: boolean
  upload: boolean
  deleteContent: boolean
  manageForms: boolean
  manageSettings: boolean
  manageUsers: boolean
  exportSubmissions: boolean
  viewAudit: boolean
}

export type MeResponse = {
  user: User
  capabilities: Capabilities
  siteOrigin: string
}

export type FieldError = {
  path: string
  message: string
}

export type MediaView = {
  id: string
  url: string
  key: string
  kind: 'image' | 'svg' | 'video' | 'file' | string
  mime: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  filename: string
  alt: string
  focus: { x: number; y: number } | null
  posterId: string | null
  tags: string[]
  source: string
  createdAt: string
}

export type MediaMap = Record<string, MediaView>

export type MediaUsage =
  | { kind: 'document'; slug: string; type: string; title: string }
  | { kind: 'entry'; id: string; collection: string; label: string }

export type DocumentView = {
  slug: string
  type: string
  title: string
  status: 'draft' | 'published' | 'archived' | string
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
  status: 'draft' | 'published' | 'archived' | string
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

export type DocumentResponse = {
  item: DocumentView
  media: MediaMap
}

export type DocumentListResponse = {
  items: DocumentView[]
}

export type EntryResponse = {
  item: EntryView
  media: MediaMap
}

export type EntryListResponse = {
  items: EntryView[]
  media: MediaMap
}

export type FormView = {
  source: string
  label: string
  enabled: boolean
  notifyEmails: string[]
  successMessage: string
  autoRegistered: boolean
  createdAt: string
  totalCount: number
  newCount: number
  lastSubmissionAt: string | null
}

export type SubmissionView = {
  id: string
  source: string
  formLabel: string | null
  status: string
  name: string | null
  email: string | null
  phone: string | null
  message: string | null
  fields: Record<string, unknown>
  pagePath: string | null
  referrer: string | null
  utm: Record<string, unknown>
  userAgent: string | null
  turnstileOk: boolean
  notes: string
  handledBy: string | null
  handledByEmail: string | null
  createdAt: string
  updatedAt: string
}

export type SubmissionListResponse = {
  items: SubmissionView[]
  total: number
  page: number
  limit: number
  counts: Record<string, number>
}

export type FormSourceOption = {
  source: string
  label: string
  count: number
}

export type DashboardResponse = {
  cards: {
    newSubmissions: number
    unpublishedChanges: number
    drafts: number
    mediaBytes: number
  }
  recentSubmissions: {
    id: string
    source: string
    formLabel: string | null
    status: string
    name: string | null
    email: string | null
    message: string | null
    createdAt: string
  }[]
  recentAudit: {
    id: string
    userEmail: string
    action: string
    entityType: string
    entityId: string | null
    summary: string
    createdAt: string
  }[]
}

export type AuditView = {
  id: string
  userEmail: string
  action: string
  entityType: string
  entityId: string | null
  summary: string
  createdAt: string
}

export type UserView = {
  id: string
  email: string
  name: string | null
  role: Role
  active: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type LookupOption = {
  value: string
  label: string
  type?: string
}

export type Lookups = {
  services: LookupOption[]
  projects: LookupOption[]
  articles: LookupOption[]
  testimonials: LookupOption[]
  clients: LookupOption[]
  pages: LookupOption[]
}

export type HealthResponse = {
  ok: boolean
  bindings: Record<string, { ok: boolean; detail: string }>
  mediaPublicBase?: string
}
