import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-react'
import { isCollectionName, type CollectionName } from '@marino/content-schema'
import { api, errorMessage } from '../api/client'
import type { EntryListResponse, EntryResponse, EntryView, MediaView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import { MediaThumb } from '../components/MediaPicker'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Panel,
  SearchInput,
  StatusBadge,
  Tabs,
} from '../components/ui'
import { entrySubtitle, entryTitle, formatDateTime } from '../lib/format'

/*
 * Collection list. Every collection shares this table; the title/subtitle and
 * thumbnail keys come from the entry's own `data`, because the five entry types
 * intentionally have different shapes.
 */

const LABELS: Record<CollectionName, string> = {
  services: 'Services',
  projects: 'Projects',
  testimonials: 'Testimonials',
  clients: 'Clients',
  articles: 'Articles',
}

const DESCRIPTIONS: Record<CollectionName, string> = {
  services: 'The services listed on the Services page and used as project filters.',
  projects: 'The Work grid. Order here is the order on the site.',
  testimonials: 'Quotes used across the site.',
  clients: 'Client names and logos for the logo strip.',
  articles: 'Journal posts, newest first by date.',
}

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
] as const

export default function Collections() {
  const { name = '' } = useParams<{ name: string }>()
  const collection = isCollectionName(name) ? name : null
  const { me } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const { data, error, loading, reload, setData } = useApi<EntryListResponse>(
    collection ? `/entries/${collection}` : null,
  )
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [creating, setCreating] = useState(false)
  const [reordering, setReordering] = useState(false)

  const canEdit = me?.capabilities.editContent ?? false
  const canDelete = me?.capabilities.deleteContent ?? false

  const items = useMemo(() => {
    const all = data?.items ?? []
    const needle = query.trim().toLowerCase()
    return all.filter((item) => {
      const title = entryTitle(item.data).toLowerCase()
      const subtitle = entrySubtitle(item.data).toLowerCase()
      const slug = (item.slug ?? '').toLowerCase()
      const matchesQuery =
        !needle || title.includes(needle) || subtitle.includes(needle) || slug.includes(needle)
      const matchesStatus = status === 'all' || item.status === status
      return matchesQuery && matchesStatus
    })
  }, [data, query, status])

  if (!collection) {
    return (
      <Panel>
        <EmptyState title="Unknown collection" description="That collection does not exist." />
      </Panel>
    )
  }

  const all = data?.items ?? []
  const counts = {
    all: all.length,
    published: all.filter((item) => item.status === 'published').length,
    draft: all.filter((item) => item.status === 'draft').length,
  }

  function mediaFor(item: EntryView): MediaView | undefined {
    const value = item.data.image ?? item.data.logo
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const id = (value as { mediaId?: unknown }).mediaId
    return typeof id === 'string' ? data?.media[id] : undefined
  }

  async function createEntry() {
    if (!collection) return
    setCreating(true)
    try {
      const nextSort = all.reduce((max, item) => Math.max(max, item.sort), -1) + 1
      const response = await api.post<EntryResponse>(`/entries/${collection}`, {
        data: { sort: nextSort },
      })
      push({ title: 'Draft created', description: 'Add the details, then publish.' })
      navigate(`/collections/${collection}/${response.item.id}`)
    } catch (cause) {
      push({ tone: 'error', title: 'Could not create the draft', description: errorMessage(cause) })
    } finally {
      setCreating(false)
    }
  }

  async function move(index: number, offset: number) {
    if (!collection || query || status !== 'all') return
    const next = index + offset
    if (next < 0 || next >= all.length) return
    const ids = all.map((item) => item.id)
    const [id] = ids.splice(index, 1)
    ids.splice(next, 0, id)

    try {
      const response = await api.post<EntryListResponse>(`/entries/${collection}/reorder`, { ids })
      setData(response)
      push({ title: 'Order saved' })
    } catch (cause) {
      push({ tone: 'error', title: 'Could not reorder', description: errorMessage(cause) })
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Collection"
        title={LABELS[collection]}
        description={DESCRIPTIONS[collection]}
        actions={
          canEdit ? (
            <Button icon={Plus} loading={creating} onClick={() => void createEntry()}>
              New entry
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={`Search ${LABELS[collection].toLowerCase()}`}
          className="max-w-[380px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={status}
            onChange={setStatus}
            items={STATUS_TABS.map((tab) => ({ ...tab, count: counts[tab.value] }))}
          />
          {canEdit && all.length > 1 && (
            <Button
              variant={reordering ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setReordering((value) => !value)}
              disabled={Boolean(query) || status !== 'all'}
            >
              {reordering ? 'Done reordering' : 'Reorder'}
            </Button>
          )}
        </div>
      </div>

      {loading && !data ? (
        <Panel>
          <LoadingRows rows={6} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : (
        <Panel className="p-[10px] lg:p-[10px]">
          {items.length === 0 ? (
            <EmptyState
              icon={GripVertical}
              title={query || status !== 'all' ? 'No matching entries' : 'Nothing here yet'}
              description={
                query || status !== 'all'
                  ? 'Clear the filters or try another search.'
                  : `Create the first ${LABELS[collection].toLowerCase().replace(/s$/, '')} entry.`
              }
              action={
                canEdit && !query && status === 'all' ? (
                  <Button icon={Plus} onClick={() => void createEntry()}>
                    New entry
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-card-lg border-b border-obsidian/10 px-3 py-3 last:border-b-0 hover:bg-fog/50"
                >
                  {reordering && canEdit && (
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => void move(index, -1)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-obsidian/45 hover:bg-white hover:text-obsidian disabled:opacity-20"
                      >
                        <ArrowUp size={13} strokeWidth={1.9} />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={index === items.length - 1}
                        onClick={() => void move(index, 1)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-obsidian/45 hover:bg-white hover:text-obsidian disabled:opacity-20"
                      >
                        <ArrowDown size={13} strokeWidth={1.9} />
                      </button>
                    </div>
                  )}
                  <MediaThumb media={mediaFor(item)} className="h-12 w-12 shrink-0" />
                  <Link
                    to={`/collections/${collection}/${item.id}`}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold">
                          {entryTitle(item.data)}
                        </span>
                        {item.changed && item.hasPublished && <Badge tone="outline">Changed</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-obsidian/45">
                        {item.slug ? `/${item.slug}` : entrySubtitle(item.data) || 'No slug'}
                      </span>
                    </span>
                    <StatusBadge status={item.status} />
                    <span className="hidden w-12 text-right text-[11px] tabular-nums text-obsidian/40 sm:block">
                      #{item.sort}
                    </span>
                    <span className="hidden w-[144px] text-right text-[11px] text-obsidian/40 md:block">
                      {formatDateTime(item.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {canDelete && all.length > 0 && (
        <p className="mt-3 text-[11px] text-obsidian/40">
          Open an entry to edit or delete it. Deleting is admin-only.
        </p>
      )}
    </>
  )
}
