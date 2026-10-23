import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Reply,
  Save,
  Trash2,
} from 'lucide-react'
import { api, errorMessage } from '../api/client'
import type { SubmissionView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingRows,
  PageHeader,
  Panel,
  PanelHeading,
  Select,
  StatusBadge,
  Textarea,
  buttonClass,
} from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/format'

/*
 * Submission detail. Opening a new row marks it read (an editor action), while
 * status and internal notes are explicit saves so a half-written note is never
 * sent by accident.
 */

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'spam', label: 'Spam' },
  { value: 'archived', label: 'Archived' },
]

type DetailResponse = {
  item: SubmissionView
  neighbours: { newerId: string | null; olderId: string | null }
}

export default function SubmissionDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { me } = useAuth()
  const { push } = useToast()
  const { data, error, loading, setData, reload } = useApi<DetailResponse>(
    id ? `/submissions/${encodeURIComponent(id)}` : null,
  )
  const [status, setStatus] = useState('read')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const autoRead = useRef<string | null>(null)

  const item = data?.item
  const canEdit = me?.capabilities.editContent ?? false
  const canDelete = me?.capabilities.deleteContent ?? false
  const notesDirty = Boolean(item && notes !== item.notes)
  useUnsavedChanges(notesDirty)

  useEffect(() => {
    if (!item) return
    setStatus(item.status)
    setNotes(item.notes)
  }, [item])

  useEffect(() => {
    if (!item || !canEdit || item.status !== 'new' || autoRead.current === item.id) return
    autoRead.current = item.id
    api
      .patch<{ item: SubmissionView }>(`/submissions/${encodeURIComponent(item.id)}`, {
        status: 'read',
      })
      .then((response) => {
        setData((current) =>
          current ? { ...current, item: response.item } : current,
        )
      })
      .catch(() => {
        // A failed auto-read is harmless; the explicit status control still works.
      })
  }, [canEdit, item, setData])

  if (loading && !data) {
    return (
      <Panel>
        <LoadingRows rows={7} />
      </Panel>
    )
  }

  if ((error && !data) || !item) {
    return (
      <>
        <PageHeader backTo="/submissions" backLabel="Inbox" eyebrow="Submission" title="Submission not found" />
        <Panel>
          <ErrorState error={error ?? new Error('This submission does not exist.')} onRetry={reload} />
        </Panel>
      </>
    )
  }

  async function persist(payload: { status?: string; notes?: string }) {
    if (!item) return
    setSaving(true)
    try {
      const response = await api.patch<{ item: SubmissionView }>(
        `/submissions/${encodeURIComponent(item.id)}`,
        payload,
      )
      setData((current) => (current ? { ...current, item: response.item } : current))
      push({ title: 'Submission updated' })
    } catch (cause) {
      push({ tone: 'error', title: 'Could not update the submission', description: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!item) return
    setDeleting(true)
    try {
      await api.delete(`/submissions/${encodeURIComponent(item.id)}`)
      push({ title: 'Submission deleted' })
      navigate('/submissions')
    } catch (cause) {
      push({ tone: 'error', title: 'Could not delete the submission', description: errorMessage(cause) })
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  const extraFields = Object.entries(item.fields).filter(([, value]) => {
    if (typeof value === 'string') return value.trim().length > 0
    return value !== null && value !== undefined
  })
  const utm = Object.entries(item.utm).filter(([, value]) => value !== undefined && value !== null && value !== '')

  return (
    <>
      <PageHeader
        backTo="/submissions"
        backLabel="Inbox"
        eyebrow="Submission"
        title={item.name || item.email || 'Anonymous submission'}
        description={`${item.formLabel ?? item.source} · ${formatDateTime(item.createdAt)}`}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Link
                to={data?.neighbours.newerId ? `/submissions/${data.neighbours.newerId}` : '#'}
                aria-disabled={!data?.neighbours.newerId}
                className={buttonClass(
                  'outline',
                  'sm',
                  !data?.neighbours.newerId ? 'pointer-events-none opacity-35' : '',
                )}
                aria-label="Newer submission"
              >
                <ArrowLeft size={14} strokeWidth={1.8} />
                Newer
              </Link>
              <Link
                to={data?.neighbours.olderId ? `/submissions/${data.neighbours.olderId}` : '#'}
                aria-disabled={!data?.neighbours.olderId}
                className={buttonClass(
                  'outline',
                  'sm',
                  !data?.neighbours.olderId ? 'pointer-events-none opacity-35' : '',
                )}
                aria-label="Older submission"
              >
                Older
                <ArrowRight size={14} strokeWidth={1.8} />
              </Link>
            </div>
            {item.email && (
              <a href={`mailto:${item.email}`} className={buttonClass('primary', 'md')}>
                <Reply size={15} strokeWidth={1.8} aria-hidden="true" />
                Reply by email
              </a>
            )}
          </>
        }
      />

      <div className="grid gap-[25px] xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-[25px]">
          <Panel>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={item.status} />
              <Badge tone="outline">{item.source}</Badge>
              {item.turnstileOk && <Badge tone="mint">Turnstile verified</Badge>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Detail label="Name" value={item.name || '—'} />
              <Detail label="Email" value={item.email || '—'} link={item.email ? `mailto:${item.email}` : undefined} />
              <Detail label="Phone" value={item.phone || '—'} link={item.phone ? `tel:${item.phone}` : undefined} />
              <Detail label="Received" value={formatDateTime(item.createdAt)} sub={relativeTime(item.createdAt)} />
            </div>

            <div className="mt-5 border-t border-obsidian/10 pt-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-obsidian/40">
                Message
              </p>
              <p className="whitespace-pre-wrap text-[14px] leading-7">
                {item.message || 'No message was submitted.'}
              </p>
            </div>

            {extraFields.length > 0 && (
              <div className="mt-5 border-t border-obsidian/10 pt-5">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-obsidian/40">
                  Extra fields
                </p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {extraFields.map(([key, value]) => (
                    <div key={key} className="rounded-card-lg bg-fog/70 px-3 py-2">
                      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                        {key}
                      </dt>
                      <dd className="mt-1 break-words text-[12px] text-obsidian/70">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeading
              title="Internal notes"
              description="Only visible to CMS users. Never returned by the public API."
              actions={canEdit ? <Save size={16} className="text-obsidian/35" aria-hidden="true" /> : undefined}
            />
            <Textarea
              value={notes}
              disabled={!canEdit}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What happened next? Who owns the follow-up?"
              rows={6}
              maxLength={5000}
              counter={`${notes.length}/5000`}
            />
            {canEdit && (
              <div className="mt-3 flex justify-end">
                <Button
                  icon={Check}
                  loading={saving}
                  disabled={!notesDirty}
                  onClick={() => void persist({ notes })}
                >
                  Save notes
                </Button>
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-[25px]">
          <Panel>
            <PanelHeading title="Status" />
            <div className="flex flex-col gap-3">
              <Select
                label="Inbox status"
                value={status}
                options={STATUS_OPTIONS}
                disabled={!canEdit}
                onChange={(event) => setStatus(event.target.value)}
              />
              <Button
                icon={Save}
                loading={saving}
                disabled={!canEdit || (status === item.status && !notesDirty)}
                onClick={() => void persist({ status, notes })}
              >
                Save changes
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || item.status === 'replied'}
                  onClick={() => void persist({ status: 'replied', notes })}
                >
                  Mark replied
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || item.status === 'archived'}
                  onClick={() => void persist({ status: 'archived', notes })}
                >
                  Archive
                </Button>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeading title="Context" />
            <dl className="flex flex-col gap-3">
              <Detail label="Page" value={item.pagePath || '—'} />
              <Detail label="Referrer" value={item.referrer || '—'} />
              <Detail
                label="Handled by"
                value={item.handledByEmail || item.handledBy || 'Unassigned'}
              />
              {utm.map(([key, value]) => (
                <Detail key={key} label={key} value={String(value)} />
              ))}
            </dl>
            {item.userAgent && (
              <div className="mt-4 border-t border-obsidian/10 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                  User agent
                </p>
                <p className="mt-1 break-all font-mono text-[10px] leading-4 text-obsidian/45">
                  {item.userAgent}
                </p>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeading title="Danger zone" />
            <p className="text-[12px] leading-5 text-obsidian/55">
              Deleting a submission is permanent. Archive it instead when you only need it out of the
              inbox.
            </p>
            {canDelete && (
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                className="mt-3"
                onClick={() => setDeleteOpen(true)}
              >
                Delete submission
              </Button>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this submission?"
        description="This is permanent and cannot be undone. The deletion is recorded in the activity log."
        confirmLabel="Delete permanently"
        loading={deleting}
        onConfirm={() => void remove()}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  )
}

function Detail({
  label,
  value,
  sub,
  link,
}: {
  label: string
  value: string
  sub?: string
  link?: string
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/40">
        {label}
      </dt>
      <dd className="mt-1 break-words text-[13px] text-obsidian/75">
        {link ? (
          <a href={link} className="underline decoration-obsidian/20 underline-offset-2">
            {value}
          </a>
        ) : (
          value
        )}
        {sub && <span className="ml-1 text-[10px] text-obsidian/35">· {sub}</span>}
      </dd>
    </div>
  )
}
