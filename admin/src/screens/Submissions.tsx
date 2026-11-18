import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Download, Filter, Inbox, Star, Trash2, Undo2, X } from 'lucide-react'
import { api, errorMessage, queryString } from '../api/client'
import type { FormSourceOption, SubmissionListResponse, SubmissionView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import {
  Badge,
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
 * Inbox (spec §7). Filters live in the URL so the dashboard's `?unread=1` and
 * a form card's `?source=...` arrive here as real filters. Selection is scoped
 * to the current page and cleared whenever the query changes, which prevents a
 * bulk action from touching an invisible row.
 *
 * Tabs map onto the API's `unread` / `starred` / `status` filters rather than
 * adding a second inbox vocabulary. Archive and spam get an undo toast because
 * they are the two actions that take a row out of the current view.
 */

type Tab = 'all' | 'unread' | 'starred' | 'archived' | 'spam'

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'starred', label: 'Starred' },
  { value: 'archived', label: 'Archived' },
  { value: 'spam', label: 'Spam' },
] as const

const BULK_ACTIONS = [
  { value: 'read', label: 'Mark as read' },
  { value: 'unread', label: 'Mark as unread' },
  { value: 'replied', label: 'Mark as replied' },
  { value: 'archive', label: 'Archive' },
  { value: 'spam', label: 'Mark as spam' },
  { value: 'restore', label: 'Restore to inbox' },
  { value: 'delete', label: 'Delete permanently' },
] as const

/** What the tab means in query-parameter terms. */
function tabParams(tab: Tab): { status?: string; unread?: number; starred?: number } {
  if (tab === 'unread') return { unread: 1 }
  if (tab === 'starred') return { starred: 1 }
  if (tab === 'archived' || tab === 'spam') return { status: tab }
  return {}
}

function initialTab(params: URLSearchParams): Tab {
  if (params.get('unread') === '1' || params.get('status') === 'unread') return 'unread'
  if (params.get('starred') === '1' || params.get('status') === 'starred') return 'starred'
  if (params.get('status') === 'archived') return 'archived'
  if (params.get('status') === 'spam') return 'spam'
  return 'all'
}

type UndoState = { ids: string[]; action: 'archive' | 'spam'; count: number }

export default function Submissions() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { me } = useAuth()
  const { push } = useToast()
  const canEdit = me?.capabilities.editContent ?? false
  const canDelete = me?.capabilities.deleteContent ?? false
  const canExport = me?.capabilities.exportSubmissions ?? false
  const bulkActions = canDelete
    ? BULK_ACTIONS
    : BULK_ACTIONS.filter((action) => action.value !== 'delete')

  const [tab, setTab] = useState<Tab>(() => initialTab(searchParams))
  const [source, setSource] = useState(() => searchParams.get('source') ?? '')
  const [project, setProject] = useState(() => searchParams.get('project') ?? '')
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [from, setFrom] = useState(() => searchParams.get('from') ?? '')
  const [to, setTo] = useState(() => searchParams.get('to') ?? '')
  const [page, setPage] = useState(() => Number(searchParams.get('page') ?? 1) || 1)
  const deferredQuery = useDeferredValue(query)
  const [showFilters, setShowFilters] = useState(
    Boolean(from || to || source || searchParams.get('source') || searchParams.get('project')),
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState('read')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [emptySpamOpen, setEmptySpamOpen] = useState(false)
  const [emptySpamBusy, setEmptySpamBusy] = useState(false)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())

  const scope = tabParams(tab)
  const path = `/submissions${queryString({
    ...scope,
    source: source || undefined,
    project: project || undefined,
    q: deferredQuery.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    limit: 25,
  })}`
  const { data, error, loading, reload, setData } = useApi<SubmissionListResponse>(path)
  const sources = useApi<{ items: FormSourceOption[] }>('/submissions/sources')
  const projects = useApi<{ items: { id: string; slug: string; title: string }[] }>(
    '/projects?limit=100',
  )
  const unread = useApi<{ count: number }>('/submissions/unread-count')

  useEffect(() => {
    const next = new URLSearchParams()
    if (tab === 'archived' || tab === 'spam') next.set('status', tab)
    if (tab === 'unread') next.set('unread', '1')
    if (tab === 'starred') next.set('starred', '1')
    if (source) next.set('source', source)
    if (project) next.set('project', project)
    if (query.trim()) next.set('q', query.trim())
    if (from) next.set('from', from)
    if (to) next.set('to', to)
    if (page > 1) next.set('page', String(page))
    setSearchParams(next, { replace: true })
  }, [tab, source, project, query, from, to, page, setSearchParams])

  useEffect(() => {
    setSelected(new Set())
    setFocusIndex(-1)
  }, [path])

  const items = data?.items ?? []
  const counts = data?.counts ?? {}
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  const filtersActive = Boolean(source || project || from || to || query.trim() || tab !== 'all')

  const tabItems = useMemo(
    () =>
      TABS.map((item) => ({
        ...item,
        count:
          item.value === 'unread'
            ? unread.data?.count
            : item.value === 'all'
              ? (counts.new ?? 0) +
                (counts.read ?? 0) +
                (counts.replied ?? 0) +
                (counts.archived ?? 0)
              : item.value === 'starred'
                ? undefined
                : (counts[item.value] ?? 0),
      })),
    [counts, unread.data],
  )

  const exportHref = `/api/admin/submissions/export${queryString({
    ...scope,
    source: source || undefined,
    project: project || undefined,
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

  function changeTab(value: string) {
    setTab(value as Tab)
    setPage(1)
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

  function afterChange() {
    reload()
    unread.reload()
    window.dispatchEvent(new Event('cms:inbox-changed'))
  }

  async function toggleStar(submission: SubmissionView) {
    if (!canEdit) return
    const next = !submission.isStarred
    // Optimistic: the star is the fastest action in the inbox.
    setData((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === submission.id ? { ...item, isStarred: next } : item,
            ),
          }
        : current,
    )
    try {
      await api.patch(`/submissions/${encodeURIComponent(submission.id)}`, { isStarred: next })
      if (tab === 'starred' && !next) afterChange()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not update the star', description: errorMessage(cause) })
      afterChange()
    }
  }

  async function runBulk(action: string) {
    if (selected.size === 0) return
    const ids = [...selected]
    setBulkBusy(true)
    try {
      const response = await api.post<{ ok: boolean; updated: number }>('/submissions/bulk', {
        ids,
        action,
      })
      push({
        title: `${response.updated} submission${response.updated === 1 ? '' : 's'} updated`,
      })
      if (action === 'archive' || action === 'spam') {
        setUndo({ ids, action, count: response.updated })
      } else {
        setUndo(null)
      }
      setSelected(new Set())
      setDeleteOpen(false)
      afterChange()
    } catch (cause) {
      push({ tone: 'error', title: 'Bulk action failed', description: errorMessage(cause) })
    } finally {
      setBulkBusy(false)
    }
  }

  async function undoBulk() {
    if (!undo) return
    setBulkBusy(true)
    try {
      await api.post('/submissions/bulk', { ids: undo.ids, action: 'restore' })
      push({ title: `Restored ${undo.count} submission${undo.count === 1 ? '' : 's'}` })
      setUndo(null)
      afterChange()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not undo', description: errorMessage(cause) })
    } finally {
      setBulkBusy(false)
    }
  }

  async function archiveRow(submission: SubmissionView) {
    if (!canEdit) return
    try {
      await api.post('/submissions/bulk', { ids: [submission.id], action: 'archive' })
      push({ title: 'Submission archived' })
      afterChange()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not archive', description: errorMessage(cause) })
    }
  }

  async function emptySpam() {
    setEmptySpamBusy(true)
    try {
      const response = await api.delete<{ ok: boolean; deleted: number }>('/submissions/spam')
      push({
        title: `Deleted ${response.deleted ?? 0} spam submission${response.deleted === 1 ? '' : 's'}`,
      })
      setEmptySpamOpen(false)
      afterChange()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not empty spam', description: errorMessage(cause) })
    } finally {
      setEmptySpamBusy(false)
    }
  }

  // Desktop keyboard shortcuts (spec §7). Never while typing or in a dialog.
  useEffect(() => {
    if (!canEdit) return

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (document.querySelector('[role="dialog"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const current = focusIndex >= 0 ? items[focusIndex] : undefined

      if (event.key === '?') {
        event.preventDefault()
        setShowShortcuts((value) => !value)
        return
      }
      if (items.length === 0) return

      if (event.key === 'j') {
        event.preventDefault()
        setFocusIndex((index) => Math.min(items.length - 1, index + 1))
      } else if (event.key === 'k') {
        event.preventDefault()
        setFocusIndex((index) => Math.max(0, index - 1))
      } else if (event.key === 'Enter' && current) {
        event.preventDefault()
        navigate(`/submissions/${current.id}`)
      } else if (event.key === 's' && current) {
        event.preventDefault()
        void toggleStar(current)
      } else if (event.key === 'e' && current) {
        event.preventDefault()
        void archiveRow(current)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    const item = focusIndex >= 0 ? items[focusIndex] : undefined
    if (!item) return
    rowRefs.current.get(item.id)?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex, items])

  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Submissions"
        description="Every contact form submission, in one inbox. Unread rows carry a mint dot and stay bold until you open them."
        actions={
          <>
            {tab === 'spam' && canDelete && (
              <Button variant="danger" size="md" icon={Trash2} onClick={() => setEmptySpamOpen(true)}>
                Empty spam
              </Button>
            )}
            <Button
              variant="outline"
              size="md"
              onClick={() => setShowShortcuts((value) => !value)}
              aria-expanded={showShortcuts}
              title="Keyboard shortcuts"
            >
              ?
            </Button>
            {canExport ? (
              <a href={exportHref} className={buttonClass('outline', 'md')}>
                <Download size={15} strokeWidth={1.7} aria-hidden="true" />
                Export CSV
              </a>
            ) : undefined}
          </>
        }
      />

      {showShortcuts && (
        <Panel className="mb-4 p-4 lg:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-obsidian/65">
              <Shortcut keys="j / k" label="Move" />
              <Shortcut keys="Enter" label="Open" />
              <Shortcut keys="s" label="Star" />
              <Shortcut keys="e" label="Archive" />
              <Shortcut keys="?" label="Toggle this hint" />
            </div>
            <button
              type="button"
              onClick={() => setShowShortcuts(false)}
              className="text-[12px] font-medium text-obsidian/50 hover:text-obsidian"
            >
              Hide
            </button>
          </div>
        </Panel>
      )}

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <SearchInput
          value={query}
          onChange={updateFilter(setQuery)}
          placeholder="Search name, email, message"
          className="max-w-[380px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onChange={changeTab} items={tabItems} />
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
            <Select
              label="Project"
              value={project}
              onChange={(event) => {
                updateFilter(setProject)(event.target.value)
              }}
              placeholder="All projects"
              options={(projects.data?.items ?? []).map((item) => ({
                value: item.slug,
                label: item.title,
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
                  setTab('all')
                  setSource('')
                  setProject('')
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
          <span className="text-[13px] font-semibold">{selected.size} selected</span>
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
            title={
              filtersActive
                ? tab === 'spam'
                  ? 'No spam'
                  : 'No matching submissions'
                : 'The inbox is empty'
            }
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
            {items.map((submission, index) => (
              <SubmissionRow
                key={submission.id}
                submission={submission}
                selectable={canEdit}
                selected={selected.has(submission.id)}
                focused={index === focusIndex}
                onToggle={() => toggle(submission.id)}
                onStar={() => void toggleStar(submission)}
                registerRef={(element) => {
                  if (element) rowRefs.current.set(submission.id, element)
                  else rowRefs.current.delete(submission.id)
                }}
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

      {undo && (
        <div
          role="status"
          className="fixed bottom-[25px] left-[25px] z-[60] flex items-center gap-3 rounded-panel bg-obsidian px-4 py-3 text-white shadow-float"
        >
          <span className="text-[12px] font-medium">
            {undo.action === 'spam' ? 'Marked as spam' : 'Archived'} · {undo.count}
          </span>
          <button
            type="button"
            onClick={() => void undoBulk()}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1.5 rounded-pill bg-primary px-3 py-1 text-[12px] font-semibold text-obsidian disabled:opacity-50"
          >
            <Undo2 size={13} strokeWidth={1.8} aria-hidden="true" />
            Undo
          </button>
          <button
            type="button"
            onClick={() => setUndo(null)}
            aria-label="Dismiss"
            className="text-white/60 hover:text-white"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={emptySpamOpen}
        title="Empty the spam folder?"
        description="Every submission marked spam is deleted permanently. This is recorded in the activity log."
        confirmLabel="Delete all spam"
        loading={emptySpamBusy}
        onConfirm={() => void emptySpam()}
        onClose={() => setEmptySpamOpen(false)}
      />

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

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-[6px] border border-obsidian/15 bg-fog px-1.5 py-0.5 font-mono text-[10px] text-obsidian/70">
        {keys}
      </kbd>
      {label}
    </span>
  )
}

function SubmissionRow({
  submission,
  selectable,
  selected,
  focused,
  onToggle,
  onStar,
  registerRef,
}: {
  submission: SubmissionView
  selectable: boolean
  selected: boolean
  focused: boolean
  onToggle: () => void
  onStar: () => void
  registerRef: (element: HTMLLIElement | null) => void
}) {
  const isUnread = !submission.readAt
  const name = submission.name || submission.email || submission.phone || 'Anonymous'
  const contact = [submission.email, submission.phone].filter(Boolean).join(' · ')
  const contextLabel =
    submission.context?.projectTitle ||
    submission.project?.title ||
    submission.context?.projectSlug ||
    submission.context?.page ||
    submission.pagePath ||
    submission.referrer ||
    'Direct'
  // Only repeat the path when the project/page label does not already say it.
  const pagePath = submission.pagePath ?? submission.referrer
  const extraPath = pagePath && pagePath !== contextLabel ? pagePath : null
  const notifyFailed = submission.notifyStatus === 'failed'

  return (
    <li
      ref={registerRef}
      className={[
        'flex items-start gap-3 rounded-card-lg border-b border-obsidian/10 px-3 py-3 last:border-b-0 hover:bg-fog/50',
        focused ? 'bg-fog ring-1 ring-obsidian/15' : '',
      ].join(' ')}
    >
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select submission from ${name}`}
          className="mt-1 h-4 w-4 shrink-0 accent-obsidian"
        />
      )}
      <Link
        to={`/submissions/${submission.id}`}
        className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1"
      >
        <span className="flex min-w-0 flex-[1.3] items-start gap-2">
          <span
            className={[
              'mt-1.5 h-2 w-2 shrink-0 rounded-full',
              isUnread ? 'bg-primary' : 'bg-obsidian/15',
            ].join(' ')}
            aria-label={isUnread ? 'Unread' : 'Read'}
          />
          <span className="min-w-0">
            <span
              className={[
                'flex items-center gap-2 truncate text-[13px]',
                isUnread ? 'font-bold' : 'font-semibold',
              ].join(' ')}
            >
              {name}
              {notifyFailed && <Badge tone="outline">Email failed</Badge>}
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
          <span className="truncate text-[11px] text-obsidian/60">{contextLabel}</span>
          {extraPath && (
            <span className="truncate text-[11px] text-obsidian/45">{extraPath}</span>
          )}
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={submission.status} />
          <span className="text-[11px] text-obsidian/40" title={formatDateTime(submission.createdAt)}>
            {relativeTime(submission.createdAt)}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={onStar}
        aria-pressed={submission.isStarred}
        aria-label={submission.isStarred ? 'Unstar submission' : 'Star submission'}
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-obsidian/35 transition-colors hover:bg-white hover:text-obsidian"
      >
        <Star
          size={16}
          strokeWidth={1.7}
          className={submission.isStarred ? 'fill-obsidian text-obsidian' : ''}
        />
      </button>
    </li>
  )
}
