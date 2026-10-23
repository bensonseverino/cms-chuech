import { useState } from 'react'
import { ScrollText, ShieldAlert, X } from 'lucide-react'
import type { AuditView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Pagination,
  Panel,
  Select,
  TextInput,
} from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/format'

/*
 * Activity log (spec §5.3 `/audit`). Append-only and admin-only. Filters map
 * directly to the indexed columns the API exposes; there is no full-text search
 * over summaries because that would scan the whole log.
 */

const ACTIONS = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'publish', label: 'Publish' },
  { value: 'unpublish', label: 'Unpublish' },
  { value: 'revert', label: 'Revert' },
  { value: 'status', label: 'Status change' },
  { value: 'bulk', label: 'Bulk / export' },
  { value: 'reorder', label: 'Reorder' },
]

const ENTITY_TYPES = [
  { value: '', label: 'All records' },
  { value: 'document', label: 'Documents' },
  { value: 'entry', label: 'Entries' },
  { value: 'media', label: 'Media' },
  { value: 'form', label: 'Forms' },
  { value: 'submission', label: 'Submissions' },
  { value: 'user', label: 'Users' },
]

type AuditResponse = {
  items: AuditView[]
  total: number
  page: number
  limit: number
}

export default function Audit() {
  const { me } = useAuth()
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [actor, setActor] = useState('')
  const [page, setPage] = useState(1)

  const params = new URLSearchParams()
  if (action) params.set('action', action)
  if (entityType) params.set('entityType', entityType)
  if (actor.trim()) params.set('user', actor.trim())
  if (page > 1) params.set('page', String(page))
  params.set('limit', '50')
  const { data, error, loading, reload } = useApi<AuditResponse>(
    me?.user.role === 'admin' ? `/audit?${params.toString()}` : null,
  )

  if (me?.user.role !== 'admin') {
    return (
      <Panel>
        <EmptyState
          icon={ShieldAlert}
          title="Admin only"
          description="The activity log is restricted to administrators."
        />
      </Panel>
    )
  }

  const filtersActive = Boolean(action || entityType || actor.trim())

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Activity log"
        description="Every write, publish and export, newest first. The log is append-only."
      />

      <div className="mb-4 flex flex-col gap-3 rounded-panel bg-white p-[18px] shadow-soft lg:flex-row lg:items-end">
        <Select
          label="Action"
          options={ACTIONS}
          value={action}
          onChange={(event) => {
            setAction(event.target.value)
            setPage(1)
          }}
          className="lg:w-[190px]"
        />
        <Select
          label="Record type"
          options={ENTITY_TYPES}
          value={entityType}
          onChange={(event) => {
            setEntityType(event.target.value)
            setPage(1)
          }}
          className="lg:w-[190px]"
        />
        <TextInput
          label="Actor email"
          type="email"
          value={actor}
          onChange={(event) => {
            setActor(event.target.value)
            setPage(1)
          }}
          placeholder="name@company.com"
          className="lg:w-[250px]"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          disabled={!filtersActive}
          onClick={() => {
            setAction('')
            setEntityType('')
            setActor('')
            setPage(1)
          }}
        >
          Clear
        </Button>
      </div>

      {loading && !data ? (
        <Panel>
          <LoadingRows rows={8} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Panel>
          <EmptyState
            icon={ScrollText}
            title={filtersActive ? 'No matching activity' : 'No activity yet'}
            description={
              filtersActive
                ? 'Clear one of the filters and try again.'
                : 'The first save, publish or inbox update will appear here.'
            }
          />
        </Panel>
      ) : (
        <Panel className="p-[10px] lg:p-[10px]">
          <div className="hidden items-center gap-3 border-b border-obsidian/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40 md:flex">
            <span className="w-[150px]">When</span>
            <span className="w-[190px]">Actor</span>
            <span className="w-[100px]">Action</span>
            <span className="w-[100px]">Record</span>
            <span className="flex-1">Summary</span>
          </div>
          <ul className="flex flex-col">
            {data?.items.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-obsidian/10 px-3 py-3 text-[12px] last:border-b-0 hover:bg-fog/50 md:flex-nowrap"
              >
                <span className="w-[150px] shrink-0 text-obsidian/50" title={formatDateTime(entry.createdAt)}>
                  {relativeTime(entry.createdAt)}
                </span>
                <span className="w-[190px] shrink-0 truncate font-mono text-[11px] text-obsidian/60">
                  {entry.userEmail}
                </span>
                <span className="w-[100px] shrink-0">
                  <Badge tone={actionTone(entry.action)}>{entry.action}</Badge>
                </span>
                <span className="w-[100px] shrink-0 text-[11px] font-medium text-obsidian/60">
                  {entry.entityType}
                </span>
                <span className="min-w-0 flex-1 break-words text-obsidian/70">
                  {entry.summary}
                  {entry.entityId && (
                    <span className="ml-1 font-mono text-[10px] text-obsidian/30">
                      {entry.entityId.slice(0, 12)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {data && (
            <div className="px-3 pb-2">
              <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
            </div>
          )}
        </Panel>
      )}
    </>
  )
}

function actionTone(action: string): 'mint' | 'lavender' | 'neutral' | 'dark' {
  if (action === 'publish') return 'mint'
  if (action === 'delete') return 'dark'
  if (action === 'create') return 'lavender'
  return 'neutral'
}
