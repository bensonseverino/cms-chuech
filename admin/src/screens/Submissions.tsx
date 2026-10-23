import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Download, Filter, Inbox, X } from 'lucide-react'
import { api, errorMessage, queryString } from '../api/client'
import type { FormSourceOption, SubmissionListResponse, SubmissionView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
  TextInput,
  buttonClass,
} from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/format'

/*
 * Inbox (spec §5.3 `/submissions`). Filters live in the URL so the dashboard's
 * `?status=new` and a form card's `?source=...` arrive here as real filters.
 * Selection is scoped to the current page and cleared whenever the query
 * changes, which prevents a bulk action from touching an invisible row.
 */

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'spam', label: 'Spam' },
  { value: 'archived', label: 'Archived' },
] as const

const BULK_ACTIONS = [
  { value: 'read', label: 'Mark as read' },
  { value: 'unread', label: 'Mark as unread' },
  { value: 'replied', label: 'Mark as replied' },
  { value: 'spam', label: 'Mark as spam' },
  { value: 'archived', label: 'Archive' },
  { value: 'delete', label: 'Delete permanently' },
] as const

export default function Submissions() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { me } = useAuth()
  const { push } = useToast()
  const canEdit = me?.capabilities.editContent ?? false
  const canDelete = me?.capabilities.deleteContent ?? false
  const canExport = me?.capabilities.exportSubmissions ?? false
  const bulkActions = canDelete
    ? BULK_ACTIONS
    : BULK_ACTIONS.filter((action) => action.value !== 'delete')

  const [status, setStatus] = useState(() => searchParams.get('status') ?? 'all')
  const [source, setSource] = useState(() => searchParams.get('source') ?? '')
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [from, setFrom] = useState(() => searchParams.get('from') ?? '')
  const [to, setTo] = useState(() => searchParams.get('to') ?? '')
  const [page, setPage] = useState(() => Number(searchParams.get('page') ?? 1) || 1)
  const deferredQuery = useDeferredValue(query)
  const [showFilters, setShowFilters] = useState(
    Boolean(from || to || source || searchParams.get('source')),
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState('read')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const path = `/submissions${queryString({
    status: status === 'all' ? undefined : status,
    source: source || undefined,
    q: deferredQuery.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    limit: 25,
  })}`
  const { data, error, loading, reload } = useApi<SubmissionListResponse>(path)
  const sources = useApi<{ items: FormSourceOption[] }>('/submissions/sources')

  useEffect(() => {
    const next = new URLSearchParams()
    if (status !== 'all') next.set('status', status)
    if (source) next.set('source', source)
    if (query.trim()) next.set('q', query.trim())
    if (from) next.set('from', from)
    if (to) next.set('to', to)
    if (page > 1) next.set('page', String(page))
    setSearchParams(next, { replace: true })
  }, [status, source, query, from, to, page, setSearchParams])

  useEffect(() => {
    setSelected(new Set())
  }, [path])

  const items = data?.items ?? []
  const counts = data?.counts ?? {}
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  const filtersActive = Boolean(source || from || to || query.trim() || status !== 'all')

  const tabItems = useMemo(
    () =>
      STATUS_TABS.map((tab) => ({
        ...tab,
        count:
          tab.value === 'all'
            ? Object.values(counts).reduce((sum, value) => sum + value, 0)
            : (counts[tab.value] ?? 0),
      })),
    [counts],
  )

  const exportHref = `/api/admin/submissions/export${queryString({
    status: status === 'all' ? undefined : status,
    source: source || undefined,
    q: query.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
  })}`

  function updateFilter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value)
      setPage(1)
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(items.map((item) => item.id)))
  }

  async function runBulk(action: string) {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const response = await api.post<{ ok: boolean; updated: number }>('/submissions/bulk', {
        ids: [...selected],
        action,
      })
      push({
        title: `${response.updated} submission${response.updated === 1 ? '' : 's'} updated`,
      })
      setSelected(new Set())
      setDeleteOpen(false)
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'Bulk action failed', description: errorMessage(cause) })
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Submissions"
        description="Every contact form submission, in one inbox. New rows are bold with a mint dot."
        actions={
          canExport ? (
            <a href={exportHref} className={buttonClass('outline', 'md')}>
              <Download size={15} strokeWidth={1.7} aria-hidden="true" />
              Export CSV
            </a>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <SearchInput
          value={query}
          onChange={updateFilter(setQuery)}
          placeholder="Search name, email, message"
          className="max-w-[380px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={status}
            onChange={updateFilter(setStatus)}
            items={tabItems}
          />
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            icon={Filter}
            onClick={() => setShowFilters((value) => !value)}
          >
            Filters
          </Button>
        </div>
      </div>

      {showFilters && (
        <Panel className="mb-4 p-[18px] lg:p-[18px]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Select
              label="Form"
              value={source}
              onChange={(event) => {
                updateFilter(setSource)(event.target.value)
              }}
              placeholder="All forms"
              options={(sources.data?.items ?? []).map((item) => ({
                value: item.source,
                label: `${item.label} (${item.count})`,
              }))}
            />
            <TextInput
              label="From"
              type="date"
              value={from}
              onChange={(event) => updateFilter(setFrom)(event.target.value)}
            />
            <TextInput
              label="To"
              type="date"
              value={to}
              onChange={(event) => updateFilter(setTo)(event.target.value)}
            />
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                onClick={() => {
                  setStatus('all')
                  setSource('')
                  setQuery('')
                  setFrom('')
                  setTo('')
                  setPage(1)
                }}
                disabled={!filtersActive}
              >
                Clear filters
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {canEdit && selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-panel bg-obsidian px-5 py-3 text-white">
          <span className="text-[13px] font-semibold">
            {selected.size} selected
          </span>
          <select
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
            className="h-9 rounded-pill border border-white/20 bg-white/10 px-3 text-[12px] text-white"
            aria-label="Bulk action"
          >
            {bulkActions.map((action) => (
              <option key={action.value} value={action.value} className="text-obsidian">
                {action.label}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            loading={bulkBusy}
            onClick={() => {
              if (bulkAction === 'delete') setDeleteOpen(true)
              else void runBulk(bulkAction)
            }}
          >
            Apply
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[12px] font-medium text-white/70 hover:text-white"
          >
            Clear selection
          </button>
        </div>
      )}

      {loading && !data ? (
        <Panel>
          <LoadingRows rows={8} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Inbox}
            title={filtersActive ? 'No matching submissions' : 'The inbox is empty'}
            description={
              filtersActive
                ? 'Clear the filters or try a different search.'
                : 'Submissions appear here as soon as the public forms send them.'
            }
          />
        </Panel>
      ) : (
        <Panel className="p-[10px] lg:p-[10px]">
          <div className="flex items-center gap-3 border-b border-obsidian/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
            {canEdit && (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all submissions on this page"
                className="h-4 w-4 accent-obsidian"
              />
            )}
            <span>{data?.total ?? 0} submissions</span>
            <span className="ml-auto hidden sm:block">Received</span>
          </div>
          <ul className="flex flex-col">
            {items.map((submission) => (
              <SubmissionRow
                key={submission.id}
                submission={submission}
                selectable={canEdit}
                selected={selected.has(submission.id)}
                onToggle={() => toggle(submission.id)}
              />
            ))}
          </ul>
          {data && (
            <div className="px-3 pb-2">
              <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
            </div>
          )}
        </Panel>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete ${selected.size} submission${selected.size === 1 ? '' : 's'}?`}
        description="This is permanent and cannot be undone. The deletion is recorded in the activity log."
        confirmLabel="Delete permanently"
        loading={bulkBusy}
        onConfirm={() => void runBulk('delete')}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  )
}

function SubmissionRow({
  submission,
  selectable,
  selected,
  onToggle,
}: {
  submission: SubmissionView
  selectable: boolean
  selected: boolean
  onToggle: () => void
}) {
  const isNew = submission.status === 'new'
  const name = submission.name || submission.email || 'Anonymous'
  const contact = [submission.email, submission.phone].filter(Boolean).join(' · ')

  return (
    <li className="flex items-start gap-3 rounded-card-lg border-b border-obsidian/10 px-3 py-3 last:border-b-0 hover:bg-fog/50">
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select submission from ${name}`}
          className="mt-1 h-4 w-4 shrink-0 accent-obsidian"
        />
      )}
      <Link to={`/submissions/${submission.id}`} className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
        <span className="flex min-w-0 flex-[1.3] items-start gap-2">
          <span
            className={[
              'mt-1.5 h-2 w-2 shrink-0 rounded-full',
              isNew ? 'bg-primary' : 'bg-obsidian/15',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className={['block truncate text-[13px]', isNew ? 'font-bold' : 'font-semibold'].join(' ')}>
              {name}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-obsidian/50">
              {contact || 'No contact details'}
            </span>
            <span className="mt-1 block truncate text-[12px] text-obsidian/60">
              {submission.message || 'No message'}
            </span>
          </span>
        </span>

        <span className="hidden min-w-0 flex-1 flex-col gap-1 sm:flex">
          <span className="truncate text-[12px] font-medium">
            {submission.formLabel ?? submission.source}
          </span>
          <span className="truncate text-[11px] text-obsidian/45">
            {submission.pagePath || submission.referrer || 'Direct'}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={submission.status} />
          <span
            className="text-[11px] text-obsidian/40"
            title={formatDateTime(submission.createdAt)}
          >
            {relativeTime(submission.createdAt)}
          </span>
        </span>
      </Link>
    </li>
  )
}
