import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Check,
  Copy,
  ExternalLink,
  Phone,
  Reply,
  Save,
  Star,
  Trash2,
} from 'lucide-react'
import { api, errorMessage } from '../api/client'
import type { SubmissionDetailResponse, SubmissionView } from '../api/types'
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
 * Submission detail (forms-reviews spec §7). Opening a row marks it read after
 * a second — long enough to back out of a mis-click — while the star and notes
 * save explicitly. Field values render under the form's own labels; when the
 * source has no definition (legacy rows) the stored key is shown instead.
 */

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'spam', label: 'Spam' },
  { value: 'archived', label: 'Archived' },
]

export default function SubmissionDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { me } = useAuth()
  const { push } = useToast()
  const { data, error, loading, setData, reload } = useApi<SubmissionDetailResponse>(
    id ? `/submissions/${encodeURIComponent(id)}` : null,
  )
  const [status, setStatus] = useState('read')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [resending, setResending] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const autoRead = useRef<string | null>(null)
  const notesRef = useRef('')

  const item = data?.item
  const canEdit = me?.capabilities.editContent ?? false
  const canDelete = me?.capabilities.deleteContent ?? false
  const notesDirty = Boolean(item && notes !== item.notes)
  useUnsavedChanges(notesDirty)
  notesRef.current = notes

  useEffect(() => {
    if (!item) return
    setStatus(item.status)
    setNotes(item.notes)
  }, [item])

  // Mark read after ~1 s (spec §7). Only unread rows, once per visit.
  useEffect(() => {
    if (!item || !canEdit || item.readAt || autoRead.current === item.id) return
    autoRead.current = item.id
    const timer = window.setTimeout(() => {
      api
        .patch<{ item: SubmissionView }>(`/submissions/${encodeURIComponent(item.id)}`, {
          read: true,
        })
        .then((response) => {
          setData((current) => (current ? { ...current, item: response.item } : current))
          window.dispatchEvent(new Event('cms:inbox-changed'))
        })
        .catch(() => {
          // A failed auto-read is harmless; the explicit controls still work.
        })
    }, 1000)
    return () => window.clearTimeout(timer)
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
        <PageHeader
          backTo="/submissions"
          backLabel="Inbox"
          eyebrow="Submission"
          title="Submission not found"
        />
        <Panel>
          <ErrorState error={error ?? new Error('This submission does not exist.')} onRetry={reload} />
        </Panel>
      </>
    )
  }

  async function persist(payload: { status?: string; notes?: string; isStarred?: boolean }, silent = false) {
    if (!item) return
    setSaving(true)
    try {
      const response = await api.patch<{ item: SubmissionView }>(
        `/submissions/${encodeURIComponent(item.id)}`,
        payload,
      )
      setData((current) => (current ? { ...current, item: response.item } : current))
      window.dispatchEvent(new Event('cms:inbox-changed'))
      if (!silent) push({ title: 'Submission updated' })
    } catch (cause) {
      push({ tone: 'error', title: 'Could not update the submission', description: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  async function resend() {
    if (!item) return
    setResending(true)
    try {
      const response = await api.post<{ ok: boolean; item: SubmissionView | null }>(
        `/submissions/${encodeURIComponent(item.id)}/resend-notification`,
      )
      if (response.item) {
        setData((current) => (current ? { ...current, item: response.item as SubmissionView } : current))
      }
      push({ title: 'Notification sent' })
    } catch (cause) {
      push({ tone: 'error', title: 'Could not resend the notification', description: errorMessage(cause) })
      reload()
    } finally {
      setResending(false)
    }
  }

  async function remove() {
    if (!item) return
    setDeleting(true)
    try {
      await api.delete(`/submissions/${encodeURIComponent(item.id)}`)
      push({ title: 'Submission deleted' })
      window.dispatchEvent(new Event('cms:inbox-changed'))
      navigate('/submissions')
    } catch (cause) {
      push({ tone: 'error', title: 'Could not delete the submission', description: errorMessage(cause) })
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      push({ title: `Copied ${label}` })
    } catch {
      push({ tone: 'error', title: 'The clipboard is not available in this browser' })
    }
  }

  const fieldDefs = data?.form?.fields ?? []
  const labelOf = (key: string) =>
    fieldDefs.find((def) => def.id === key)?.label ?? key.replace(/_/g, ' ')

  const fieldEntries = Object.entries(item.fields).filter(([key, value]) => {
    if (key.startsWith('_')) return false
    if (typeof value === 'string') return value.trim().length > 0
    return value !== null && value !== undefined && value !== false
  })
  const orderedKeys = [
    ...fieldDefs.map((def) => def.id).filter((key) => fieldEntries.some(([entry]) => entry === key)),
    ...fieldEntries.map(([key]) => key).filter((key) => !fieldDefs.some((def) => def.id === key)),
  ]
  const orderedFields = orderedKeys.map((key) => [key, item.fields[key]] as const)
  const utm = Object.entries(item.utm).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  )
  const contextPage = item.context?.page || item.pagePath
  const contextProject = item.context?.projectTitle || item.project?.title
  const siteOrigin = (me?.siteOrigin ?? '').replace(/\/+$/, '')
  const notifyLabel =
    item.notifyStatus === 'sent'
      ? 'Notification sent'
      : item.notifyStatus === 'failed'
        ? 'Notification failed'
        : item.notifyStatus === 'skipped'
          ? 'Notification skipped'
          : 'Notification pending'

  return (
    <>
      <PageHeader
        backTo="/submissions"
        backLabel="Inbox"
        eyebrow="Submission"
        title={item.name || item.email || item.phone || 'Anonymous submission'}
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
            {canEdit && (
              <Button
                variant={item.isStarred ? 'secondary' : 'outline'}
                size="md"
                icon={Star}
                loading={saving}
                onClick={() => void persist({ isStarred: !item.isStarred }, true)}
              >
                {item.isStarred ? 'Starred' : 'Star'}
              </Button>
            )}
            {item.phone && (
              <a href={`tel:${item.phone}`} className={buttonClass('outline', 'md')}>
                <Phone size={15} strokeWidth={1.8} aria-hidden="true" />
                Call
              </a>
            )}
            {item.email && (
              <a
                href={`mailto:${item.email}?subject=${encodeURIComponent(
                  `Re: ${item.formLabel ?? 'your message'}`,
                )}`}
                className={buttonClass('primary', 'md')}
              >
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
              {item.isStarred && <Badge tone="mint">Starred</Badge>}
              {item.turnstileOk && <Badge tone="mint">Turnstile verified</Badge>}
              <Badge tone={item.notifyStatus === 'failed' ? 'dark' : 'neutral'}>{notifyLabel}</Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Detail label="Name" value={item.name || '—'} />
              <Detail
                label="Email"
                value={item.email || '—'}
                link={item.email ? `mailto:${item.email}` : undefined}
              />
              <Detail
                label="Phone"
                value={item.phone || '—'}
                link={item.phone ? `tel:${item.phone}` : undefined}
              />
              <Detail
                label="Received"
                value={formatDateTime(item.createdAt)}
                sub={relativeTime(item.createdAt)}
              />
            </div>

            <div className="mt-5 border-t border-obsidian/10 pt-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-obsidian/40">
                Message
              </p>
              <p className="whitespace-pre-wrap text-[14px] leading-7">
                {item.message || 'No message was submitted.'}
              </p>
            </div>

            {orderedFields.length > 0 && (
              <div className="mt-5 border-t border-obsidian/10 pt-5">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-obsidian/40">
                  Submitted fields
                </p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {orderedFields.map(([key, value]) => {
                    const shown = Array.isArray(value)
                      ? value.map((entry) => String(entry)).join(', ')
                      : typeof value === 'boolean'
                        ? value
                          ? 'Yes'
                          : 'No'
                        : String(value)
                    return (
                      <div key={key} className="group rounded-card-lg bg-fog/70 px-3 py-2">
                        <dt className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                          <span className="truncate">{labelOf(key)}</span>
                          <button
                            type="button"
                            onClick={() => void copyValue(labelOf(key), shown)}
                            aria-label={`Copy ${labelOf(key)}`}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-obsidian/35 opacity-0 transition-opacity hover:bg-white hover:text-obsidian focus:opacity-100 group-hover:opacity-100"
                          >
                            <Copy size={12} strokeWidth={1.8} />
                          </button>
                        </dt>
                        <dd className="mt-1 break-words text-[12px] text-obsidian/70">{shown}</dd>
                      </div>
                    )
                  })}
                </dl>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeading
              title="Internal notes"
              description="Only visible to CMS users. Never returned by the public API. Notes save when you leave the field."
              actions={
                canEdit ? <Save size={16} className="text-obsidian/35" aria-hidden="true" /> : undefined
              }
            />
            <Textarea
              value={notes}
              disabled={!canEdit}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if (canEdit && notesRef.current !== item.notes) {
                  void persist({ notes: notesRef.current }, true)
                }
              }}
              placeholder="What happened next? Who owns the follow-up?"
              rows={6}
              maxLength={5000}
              counter={`${notes.length}/5000`}
            />
            {canEdit && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-obsidian/40">
                  {saving ? 'Saving…' : notesDirty ? 'Unsaved changes' : 'Saved'}
                </p>
                <Button
                  icon={Check}
                  size="sm"
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
            <PanelHeading title="Notification" />
            <p className="text-[12px] leading-5 text-obsidian/60">
              {item.notifyStatus === 'failed'
                ? 'The owner email did not send. The submission is stored safely — retry below.'
                : item.notifyStatus === 'skipped'
                  ? 'Email is not configured, so nothing was sent. The submission is still stored.'
                  : item.notifyStatus === 'sent'
                    ? 'The owner email was delivered.'
                    : 'The owner email is still pending.'}
            </p>
            {item.notifyError && (
              <p className="mt-2 break-words rounded-card-lg bg-fog px-3 py-2 font-mono text-[10px] leading-4 text-obsidian/55">
                {item.notifyError}
              </p>
            )}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                icon={BellRing}
                className="mt-3"
                loading={resending}
                onClick={() => void resend()}
              >
                Resend notification
              </Button>
            )}
          </Panel>

          <Panel>
            <PanelHeading title="Context" />
            <dl className="flex flex-col gap-3">
              {contextProject && <Detail label="Project" value={contextProject} />}
              {contextPage && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/40">
                    Submitted from
                  </dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2 break-words text-[13px] text-obsidian/75">
                    <span>{contextPage}</span>
                    {siteOrigin && contextPage.startsWith('/') && (
                      <a
                        href={`${siteOrigin}${contextPage}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium underline decoration-obsidian/20 underline-offset-2"
                      >
                        Open site
                        <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" />
                      </a>
                    )}
                  </dd>
                </div>
              )}
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
