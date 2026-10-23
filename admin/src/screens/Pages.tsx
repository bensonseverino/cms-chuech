import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { FileText, FolderCog, Plus, Search } from 'lucide-react'
import {
  DOCUMENTS,
  DOCUMENT_TEMPLATES,
  isDocumentType,
  isValidSlug,
  slugify,
} from '@marino/content-schema'
import { api, errorMessage } from '../api/client'
import type { DocumentListResponse, DocumentView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  StatusBadge,
  TextInput,
} from '../components/ui'
import { formatDateTime, entryTitle } from '../lib/format'

const SINGLETON_ORDER = [
  'site',
  'navigation',
  'footer',
  'home',
  'services_index',
  'work_index',
] as const

export default function Pages() {
  const { me } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApi<DocumentListResponse>('/documents')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [type, setType] = useState<'page' | 'service_page'>('page')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const canEdit = me?.capabilities.editContent ?? false

  const { singletons, pages } = useMemo(() => {
    const items = data?.items ?? []
    const needle = query.trim().toLowerCase()
    const matches = (item: DocumentView) =>
      !needle ||
      item.title.toLowerCase().includes(needle) ||
      item.slug.toLowerCase().includes(needle) ||
      item.type.toLowerCase().includes(needle)

    const singletonItems = [...items]
      .filter((item) => item.type !== 'page' && item.type !== 'service_page' && matches(item))
      .sort(
        (a, b) =>
          SINGLETON_ORDER.indexOf(a.type as (typeof SINGLETON_ORDER)[number]) -
          SINGLETON_ORDER.indexOf(b.type as (typeof SINGLETON_ORDER)[number]),
      )

    const pageItems = items
      .filter((item) => (item.type === 'page' || item.type === 'service_page') && matches(item))
      .sort((a, b) => a.title.localeCompare(b.title))

    return { singletons: singletonItems, pages: pageItems }
  }, [data, query])

  function openCreate(nextType: 'page' | 'service_page' = 'page') {
    setType(nextType)
    const template = DOCUMENT_TEMPLATES[nextType]
    setTitle(template.title)
    setSlug(slugify(template.title))
    setSlugTouched(false)
    setCreateError(null)
    setCreateOpen(true)
  }

  async function createDocument(event: FormEvent) {
    event.preventDefault()
    if (!isValidSlug(slug)) {
      setCreateError('Use lowercase letters, numbers and hyphens for the slug.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const template = DOCUMENT_TEMPLATES[type]
      const created = await api.post<{ item: DocumentView }>('/documents', {
        type,
        title: title.trim() || template.title,
        slug,
        data: { ...template.data, title: title.trim() || template.title },
      })
      push({ title: 'Page created', description: created.item.title })
      setCreateOpen(false)
      navigate(`/pages/${created.item.slug}`)
    } catch (cause) {
      setCreateError(errorMessage(cause))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Pages"
        description="Every document in the CMS: site settings, navigation, the three index pages, and any service or generic pages you add."
        actions={
          canEdit ? (
            <Button icon={Plus} onClick={() => openCreate('page')}>
              New page
            </Button>
          ) : undefined
        }
      />

      <div className="mb-[25px] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search pages"
          className="max-w-[380px]"
        />
        <p className="text-[12px] text-obsidian/45">
          {(data?.items.length ?? 0)} document{(data?.items.length ?? 0) === 1 ? '' : 's'}
        </p>
      </div>

      {loading && !data ? (
        <Panel>
          <LoadingRows rows={7} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : (
        <div className="flex flex-col gap-[25px]">
          <Panel>
            <div className="mb-4 flex items-center gap-2">
              <FolderCog size={17} strokeWidth={1.5} aria-hidden="true" />
              <h3 className="text-[18px] font-bold">Site &amp; index pages</h3>
              <Badge tone="outline">{singletons.length}</Badge>
            </div>
            {singletons.length === 0 ? (
              <EmptyState
                icon={Search}
                title={query ? 'No matching settings' : 'The singletons are not seeded yet'}
                description={
                  query
                    ? 'Try another search.'
                    : 'Run the seed migration to create the site, navigation, footer, Home, Services and Work documents.'
                }
              />
            ) : (
              <ul className="flex flex-col">
                {singletons.map((item) => (
                  <li key={item.slug} className="border-t border-obsidian/10 first:border-t-0">
                    <Link
                      to={`/pages/${item.slug}`}
                      className="flex flex-wrap items-center gap-3 py-4 transition-colors hover:bg-fog/60"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fog">
                        <FileText size={16} strokeWidth={1.6} className="text-obsidian/60" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold">{item.title}</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-obsidian/40">
                          {item.slug} · {labelFor(item.type)}
                        </span>
                      </span>
                      <StatusBadge status={item.status} changed={item.changed} hasPublished={item.hasPublished} />
                      <span className="hidden w-[150px] text-right text-[11px] text-obsidian/40 sm:block">
                        {formatDateTime(item.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText size={17} strokeWidth={1.5} aria-hidden="true" />
                <h3 className="text-[18px] font-bold">Pages</h3>
                <Badge tone="outline">{pages.length}</Badge>
              </div>
              {canEdit && (
                <Button variant="outline" size="sm" icon={Plus} onClick={() => openCreate('service_page')}>
                  New service page
                </Button>
              )}
            </div>

            {pages.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={query ? 'No matching pages' : 'No pages yet'}
                description={
                  query
                    ? 'Try another search.'
                    : 'Create a generic page for About, Contact or a policy, or a service page for one of your offers.'
                }
                action={canEdit ? <Button icon={Plus} onClick={() => openCreate('page')}>New page</Button> : undefined}
              />
            ) : (
              <ul className="flex flex-col">
                {pages.map((item) => (
                  <li key={item.slug} className="border-t border-obsidian/10 first:border-t-0">
                    <Link
                      to={`/pages/${item.slug}`}
                      className="flex flex-wrap items-center gap-3 py-4 transition-colors hover:bg-fog/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold">{entryTitle(item.data, item.title)}</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-obsidian/40">
                          /{item.slug} · {labelFor(item.type)}
                        </span>
                      </span>
                      <StatusBadge status={item.status} changed={item.changed} hasPublished={item.hasPublished} />
                      <span className="hidden w-[150px] text-right text-[11px] text-obsidian/40 sm:block">
                        {formatDateTime(item.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={type === 'service_page' ? 'New service page' : 'New page'}
        description="The slug is the public URL. It can change until the page is first published."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-page-form" loading={creating}>
              Create page
            </Button>
          </>
        }
      >
        <form id="create-page-form" onSubmit={createDocument} className="flex flex-col gap-4">
          <div className="flex gap-2">
            {(['page', 'service_page'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setType(value)
                  setTitle(DOCUMENT_TEMPLATES[value].title)
                  if (!slugTouched) setSlug(slugify(DOCUMENT_TEMPLATES[value].title))
                }}
                className={[
                  'h-10 flex-1 rounded-pill border text-[12px] font-semibold transition-colors',
                  type === value
                    ? 'border-obsidian bg-primary/40'
                    : 'border-obsidian/15 bg-white text-obsidian/60',
                ].join(' ')}
              >
                {value === 'page' ? 'Generic page' : 'Service page'}
              </button>
            ))}
          </div>
          <TextInput
            label="Title"
            required
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              if (!slugTouched) setSlug(slugify(event.target.value))
            }}
            autoFocus
          />
          <TextInput
            label="Slug"
            required
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value)
              setSlugTouched(true)
            }}
            hint={`Public URL: /${slug || '…'}`}
          />
          {createError && <p className="text-[12px] font-medium">{createError}</p>}
        </form>
      </Modal>
    </>
  )
}

function labelFor(type: string): string {
  if (!isDocumentType(type)) return type
  return DOCUMENTS[type].label
}
