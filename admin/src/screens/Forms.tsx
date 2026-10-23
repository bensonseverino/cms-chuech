import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, FormInput, Mail, Save, Settings2, ShieldAlert } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import type { FormView } from '../api/types'
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
  Textarea,
  TextInput,
  Toggle,
  buttonClass,
} from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/format'

/*
 * Forms are fixed-shape and registered by the public intake; this screen only
 * edits routing (enabled, notification emails) and the success copy. It cannot
 * add or remove a source, which is exactly the spec's constraint.
 */

export default function Forms() {
  const { me } = useAuth()
  const { push } = useToast()
  const { data, error, loading, reload } = useApi<{ items: FormView[] }>(
    me?.capabilities.manageForms ? '/forms' : null,
  )
  const [editing, setEditing] = useState<FormView | null>(null)

  if (!me?.capabilities.manageForms) {
    return (
      <Panel>
        <EmptyState
          icon={ShieldAlert}
          title="Admin only"
          description="Your role can read the inbox but cannot change form routing."
        />
      </Panel>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Forms"
        description="Where each published form sends its notifications and what visitors see after submitting. A new source is registered automatically by the public intake, never here."
        actions={
          <Link to="/submissions" className={buttonClass('outline', 'md')}>
            Open inbox
            <ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        }
      />

      {loading && !data ? (
        <Panel>
          <LoadingRows rows={5} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Panel>
          <EmptyState
            icon={FormInput}
            title="No forms yet"
            description="The public intake registers a source the first time a form with a new `source` value is submitted. Configure it here once that happens."
          />
        </Panel>
      ) : (
        <div className="grid gap-[25px] xl:grid-cols-2">
          {data?.items.map((form) => (
            <Panel key={form.source} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[18px] font-bold">{form.label}</h3>
                    {!form.enabled && <Badge tone="dark">Disabled</Badge>}
                    {form.autoRegistered && <Badge tone="outline">Auto</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-obsidian/40">{form.source}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  icon={Settings2}
                  onClick={() => setEditing(form)}
                >
                  Configure
                </Button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-card-lg bg-fog px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/40">
                    Total
                  </p>
                  <p className="mt-1 text-[24px] font-bold leading-none">{form.totalCount}</p>
                </div>
                <div className="rounded-card-lg bg-primary/25 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/45">
                    New
                  </p>
                  <p className="mt-1 text-[24px] font-bold leading-none">{form.newCount}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 text-[12px] text-obsidian/55">
                <p className="flex items-start gap-2">
                  <Mail size={14} strokeWidth={1.7} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {form.notifyEmails.length > 0
                      ? form.notifyEmails.join(', ')
                      : 'No notification emails configured.'}
                  </span>
                </p>
                <p>
                  Last submission:{' '}
                  <span title={formatDateTime(form.lastSubmissionAt)}>
                    {form.lastSubmissionAt ? relativeTime(form.lastSubmissionAt) : 'never'}
                  </span>
                </p>
                <p className="rounded-card-lg bg-fog/60 px-3 py-2 text-[11px] leading-5">
                  {form.successMessage}
                </p>
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 pt-5">
                <Link
                  to={`/submissions?source=${encodeURIComponent(form.source)}`}
                  className="text-[12px] font-semibold underline decoration-obsidian/20 underline-offset-4 hover:decoration-obsidian"
                >
                  View submissions
                </Link>
                <span className="font-mono text-[10px] text-obsidian/30">{form.source}</span>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <FormSettingsDialog
        form={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
        }}
        onError={(message) => push({ tone: 'error', title: 'Could not save the form', description: message })}
        canEdit={me?.capabilities.manageForms ?? false}
      />
    </>
  )
}

function FormSettingsDialog({
  form,
  onClose,
  onSaved,
  onError,
  canEdit,
}: {
  form: FormView | null
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
  canEdit: boolean
}) {
  const [label, setLabel] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [emails, setEmails] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!form) return
    setLabel(form.label)
    setEnabled(form.enabled)
    setEmails(form.notifyEmails.join('\n'))
    setSuccessMessage(form.successMessage)
  }, [form])

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      await api.put(`/forms/${encodeURIComponent(form.source)}`, {
        label,
        enabled,
        notifyEmails: emails.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean),
        successMessage,
      })
      onSaved()
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={form !== null}
      onClose={onClose}
      title={form ? `Configure ${form.label}` : 'Configure form'}
      description={form ? `Public source: ${form.source}` : undefined}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon={Save} loading={saving} onClick={() => void save()} disabled={!canEdit}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          disabled={!canEdit}
          label="Accept submissions"
          description="When off, the public intake returns a validation error for this source."
        />
        <TextInput
          label="Admin label"
          value={label}
          maxLength={120}
          disabled={!canEdit}
          onChange={(event) => setLabel(event.target.value)}
          hint="Shown in the inbox and on the dashboard."
        />
        <Textarea
          label="Notification emails"
          value={emails}
          disabled={!canEdit}
          onChange={(event) => setEmails(event.target.value)}
          hint="One email per line, or separated by commas. Leave empty to keep everything in the inbox only."
          rows={3}
        />
        <Textarea
          label="Success message"
          value={successMessage}
          maxLength={500}
          disabled={!canEdit}
          onChange={(event) => setSuccessMessage(event.target.value)}
          hint={`${successMessage.length}/500 · Returned to the public form after a successful submission.`}
          rows={3}
        />
      </div>
    </Modal>
  )
}
