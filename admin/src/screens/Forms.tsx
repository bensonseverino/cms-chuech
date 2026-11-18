import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Copy,
  FormInput,
  Mail,
  Plus,
  Save,
  Settings2,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { api, errorMessage } from '../api/client'
import type { AutoresponderConfig, FormFieldDefView, FormView } from '../api/types'
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
  PanelHeading,
  Select,
  Textarea,
  TextInput,
  Toggle,
  buttonClass,
} from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/format'

/*
 * Forms (forms-reviews spec §7). The public intake registers a source; this
 * screen edits routing, the success copy, the field builder and the optional
 * autoresponder. Field keys are what the live website posts, so they stay
 * locked behind "Advanced: edit key" with a warning.
 */

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Select' },
  { value: 'radio', label: 'Radio' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'checkboxes', label: 'Checkboxes' },
  { value: 'url', label: 'URL' },
]

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/

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
        description="Where each published form sends its notifications, what visitors see after submitting, and the fields it accepts. A new source is registered automatically by the public intake, never here."
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
                    {form.autoresponder?.enabled && <Badge tone="lavender">Autoresponder</Badge>}
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
                <p>
                  {form.fields.length} field{form.fields.length === 1 ? '' : 's'} ·{' '}
                  {form.fields.map((field) => field.id).join(', ') || 'no definition'}
                </p>
                <p
                  className={[
                    'rounded-card-lg px-3 py-2 text-[11px] leading-5',
                    form.successMessage ? 'bg-fog/60 text-obsidian/65' : 'bg-fog/40 text-obsidian/40',
                  ].join(' ')}
                >
                  {form.successMessage || 'No success message set — visitors see the default.'}
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
        siteOrigin={me?.siteOrigin ?? ''}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
        }}
        onError={(message) =>
          push({ tone: 'error', title: 'Could not save the form', description: message })
        }
        canEdit={me?.capabilities.manageForms ?? false}
      />
    </>
  )
}

function FormSettingsDialog({
  form,
  siteOrigin,
  onClose,
  onSaved,
  onError,
  canEdit,
}: {
  form: FormView | null
  siteOrigin: string
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
  canEdit: boolean
}) {
  const [label, setLabel] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [emails, setEmails] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [fields, setFields] = useState<FormFieldDefView[]>([])
  const [autoresponder, setAutoresponder] = useState<AutoresponderConfig>({
    enabled: false,
    subject: '',
    body: '',
  })
  const [advancedKeys, setAdvancedKeys] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!form) return
    setLabel(form.label)
    setEnabled(form.enabled)
    setEmails(form.notifyEmails.join('\n'))
    setSuccessMessage(form.successMessage)
    setFields(form.fields.map((field) => ({ ...field })))
    setAutoresponder(
      form.autoresponder
        ? { ...form.autoresponder }
        : { enabled: false, subject: '', body: '' },
    )
    setAdvancedKeys(false)
    setCopied(false)
  }, [form])

  if (!form) return null

  const origin = siteOrigin.replace(/\/+$/, '') || 'https://your-site.example'
  const endpoint = `${origin}/api/public/forms/${form.source}/submissions`
  const exampleValues: Record<string, unknown> = {}
  for (const field of fields) {
    exampleValues[field.id] =
      field.type === 'email'
        ? 'amina@example.com'
        : field.type === 'tel'
          ? '+254700000000'
          : field.type === 'checkbox'
            ? true
            : field.options?.length
              ? field.options[0]
              : field.id === 'name'
                ? 'Amina'
                : 'Example'
  }
  const payload = {
    values: exampleValues,
    website: '',
    elapsedMs: 3200,
    turnstileToken: '<token>',
    context: { page: '/' },
  }
  const curl = `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload, null, 2)}'`

  function updateField(index: number, patch: Partial<FormFieldDefView>) {
    setFields((current) =>
      current.map((field, position) => (position === index ? { ...field, ...patch } : field)),
    )
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function addField() {
    const suggested = `field_${fields.length + 1}`
    setFields((current) => [
      ...current,
      { id: suggested, type: 'text', label: 'New field', required: false },
    ])
    setAdvancedKeys(true)
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      onError('The clipboard is not available in this browser')
    }
  }

  async function save() {
    if (!form) return
    const badField = fields.find(
      (field) => !KEY_RE.test(field.id.trim()) || !field.label.trim() || !field.type,
    )
    if (badField) {
      onError(
        `Field key '${badField.id}' must start with a letter and use only letters, numbers and underscores, and every field needs a label.`,
      )
      return
    }
    if (new Set(fields.map((field) => field.id)).size !== fields.length) {
      onError('Two fields share a key. Keys must be unique.')
      return
    }

    setSaving(true)
    try {
      await api.put(`/forms/${encodeURIComponent(form.source)}`, {
        label,
        enabled,
        notifyEmails: emails.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean),
        successMessage,
        fields: fields.map((field) => ({
          id: field.id.trim(),
          type: field.type,
          label: field.label.trim(),
          ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          ...(field.required ? { required: true } : {}),
          ...(field.options && field.options.length > 0 ? { options: field.options } : {}),
        })),
        autoresponder: autoresponder.enabled || autoresponder.subject ? autoresponder : null,
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
      size="xl"
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
      <div className="flex flex-col gap-[25px]">
        <div className="flex flex-col gap-5">
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            disabled={!canEdit}
            label="Accept submissions"
            description="When off, the public intake rejects this source instead of storing anything."
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
            hint="One email per line, or separated by commas. Leave empty to use the global notification settings."
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

        <div className="border-t border-obsidian/10 pt-5">
          <PanelHeading
            title="Fields"
            description="The keys are what the website posts. Order is the order visitors see."
            actions={
              <Button variant="outline" size="sm" icon={Plus} onClick={addField} disabled={!canEdit}>
                Add field
              </Button>
            }
          />

          {!advancedKeys ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-card-lg bg-fog px-3 py-2">
              <p className="text-[11px] leading-4 text-obsidian/55">
                Keys are locked because the website depends on them.
              </p>
              <button
                type="button"
                onClick={() => setAdvancedKeys(true)}
                disabled={!canEdit}
                className="text-[11px] font-semibold underline decoration-obsidian/25 underline-offset-4 hover:decoration-obsidian"
              >
                Advanced: edit key
              </button>
            </div>
          ) : (
            <p className="mb-3 rounded-card-lg bg-secondary/40 px-3 py-2 text-[11px] font-medium leading-4 text-obsidian/75">
              The website uses these keys. Changing one will break the form until the frontend is
              updated.
            </p>
          )}

          {fields.length === 0 ? (
            <p className="rounded-card-lg border border-obsidian/10 px-3 py-4 text-[12px] text-obsidian/45">
              No fields defined. The intake stores only the reserved keys until you add some.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {fields.map((field, index) => (
                <li key={index} className="rounded-card-lg border border-obsidian/10 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <TextInput
                      label="Label"
                      value={field.label}
                      disabled={!canEdit}
                      onChange={(event) => updateField(index, { label: event.target.value })}
                      className="min-w-[160px] flex-1"
                    />
                    <TextInput
                      label="Key"
                      value={field.id}
                      disabled={!canEdit || !advancedKeys}
                      onChange={(event) => updateField(index, { id: event.target.value })}
                      className="min-w-[130px] flex-1 font-mono"
                    />
                    <Select
                      label="Type"
                      value={field.type}
                      disabled={!canEdit}
                      onChange={(event) => updateField(index, { type: event.target.value })}
                      options={FIELD_TYPES}
                      className="min-w-[120px]"
                    />
                    <div className="flex h-11 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveField(index, -1)}
                        disabled={!canEdit || index === 0}
                        aria-label="Move field up"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/40 hover:bg-fog hover:text-obsidian disabled:opacity-30"
                      >
                        <ArrowUp size={14} strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(index, 1)}
                        disabled={!canEdit || index === fields.length - 1}
                        aria-label="Move field down"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/40 hover:bg-fog hover:text-obsidian disabled:opacity-30"
                      >
                        <ArrowDown size={14} strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFields((current) => current.filter((_, position) => position !== index))
                        }
                        disabled={!canEdit}
                        aria-label="Remove field"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/40 hover:bg-fog hover:text-obsidian"
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <Toggle
                      checked={field.required ?? false}
                      disabled={!canEdit}
                      onChange={(checked) => updateField(index, { required: checked })}
                      label="Required"
                    />
                    <TextInput
                      label="Placeholder"
                      value={field.placeholder ?? ''}
                      disabled={!canEdit}
                      onChange={(event) => updateField(index, { placeholder: event.target.value })}
                      className="min-w-[200px] flex-1"
                    />
                  </div>
                  {(field.type === 'select' ||
                    field.type === 'radio' ||
                    field.type === 'checkboxes') && (
                    <TextInput
                      label="Options"
                      value={(field.options ?? []).join(', ')}
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateField(index, {
                          options: event.target.value
                            .split(',')
                            .map((option) => option.trim())
                            .filter(Boolean),
                        })
                      }
                      hint="Comma separated."
                      className="mt-2"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-obsidian/10 pt-5">
          <PanelHeading
            title="Autoresponder"
            description="Optional confirmation email to the visitor. Off by default."
          />
          <div className="flex flex-col gap-3">
            <Toggle
              checked={autoresponder.enabled}
              disabled={!canEdit}
              onChange={(checked) => setAutoresponder((current) => ({ ...current, enabled: checked }))}
              label="Send a confirmation"
              description="Only sends when the submission includes a valid email address."
            />
            {autoresponder.enabled && (
              <>
                <TextInput
                  label="Subject"
                  value={autoresponder.subject}
                  maxLength={200}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setAutoresponder((current) => ({ ...current, subject: event.target.value }))
                  }
                  placeholder="Thanks for reaching out"
                />
                <Textarea
                  label="Body"
                  value={autoresponder.body}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setAutoresponder((current) => ({ ...current, body: event.target.value }))
                  }
                  hint="Plain text. Use {{name}} to insert the visitor's name."
                  rows={5}
                />
              </>
            )}
          </div>
        </div>

        <div className="border-t border-obsidian/10 pt-5">
          <PanelHeading
            title="Example request"
            description="Copy this curl to exercise the live endpoint."
            actions={
              <Button variant="outline" size="sm" icon={Copy} onClick={() => void copyCurl()}>
                {copied ? 'Copied' : 'Copy curl'}
              </Button>
            }
          />
          <pre className="overflow-x-auto rounded-card-lg bg-obsidian p-4 font-mono text-[11px] leading-5 text-white/85">
            {curl}
          </pre>
        </div>
      </div>
    </Modal>
  )
}
