import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import type { FieldDef, MediaAccept } from '@marino/content-schema'
import type { FieldError, Lookups, MediaMap, MediaView } from '../api/types'
import { MediaFieldInput, type MediaValue } from './MediaPicker'
import {
  Button,
  RichTextPreview,
  Select,
  TextInput,
  Textarea,
  Toggle,
  cn,
} from './ui'

/*
 * Schema-driven record editor.
 *
 * The FieldDef catalog is the only source of truth for the form: groups,
 * repeaters, lists, media pickers and reference selects are rendered from the
 * same field list the publish validator walks. A new field in the schema shows
 * up here without a new screen.
 */

export type FieldEditorProps = {
  fields: readonly FieldDef[]
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  errors?: readonly FieldError[]
  prefix?: string
  media?: MediaMap
  onMedia?: (media: MediaView) => void
  lookups?: Lookups | null
  disabled?: boolean
}

export function FieldEditor({
  fields,
  value,
  onChange,
  errors = [],
  prefix = '',
  media = {},
  onMedia = () => {},
  lookups = null,
  disabled = false,
}: FieldEditorProps) {
  return (
    <div className="flex flex-col gap-[25px]">
      {fields.map((field) => (
        <FieldRow
          key={field.path}
          field={field}
          value={value}
          onChange={onChange}
          errors={errors}
          prefix={prefix}
          media={media}
          onMedia={onMedia}
          lookups={lookups}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

function FieldRow({
  field,
  value,
  onChange,
  errors,
  prefix,
  media,
  onMedia,
  lookups,
  disabled,
}: {
  field: FieldDef
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  errors: readonly FieldError[]
  prefix: string
  media: MediaMap
  onMedia: (media: MediaView) => void
  lookups: Lookups | null
  disabled: boolean
}) {
  const path = prefix ? `${prefix}.${field.path}` : field.path
  const raw = value[field.path]
  const error = directError(errors, path)
  const set = (next: unknown) => {
    const copy = { ...value }
    if (next === undefined) delete copy[field.path]
    else copy[field.path] = next
    onChange(copy)
  }
  const maxLength = 'max' in field && typeof field.max === 'number' ? field.max : undefined
  const counter =
    typeof raw === 'string' && maxLength ? `${raw.length}/${maxLength}` : undefined

  switch (field.type) {
    case 'text':
    case 'link':
      return (
        <TextInput
          label={field.label}
          required={field.required}
          hint={field.help ?? (field.type === 'link' ? '/path or https://…' : undefined)}
          error={error}
          counter={counter}
          maxLength={maxLength}
          placeholder={
            field.type === 'text' ? field.placeholder : field.type === 'link' ? '/about' : undefined
          }
          value={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      )

    case 'textarea':
      return (
        <Textarea
          label={field.label}
          required={field.required}
          hint={field.help}
          error={error}
          counter={counter}
          maxLength={maxLength}
          rows={field.rows ?? 4}
          value={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      )

    case 'inline':
      return (
        <div className="flex flex-col gap-2">
          <Textarea
            label={field.label}
            required={field.required}
            hint={field.help ?? '**bold**  ==highlight==  [text](/path). Blank line starts a paragraph.'}
            error={error}
            counter={counter}
            maxLength={maxLength}
            rows={4}
            value={typeof raw === 'string' ? raw : ''}
            disabled={disabled}
            onChange={(event) => set(event.target.value)}
          />
          {typeof raw === 'string' && raw.trim().length > 0 && (
            <div className="rounded-card-lg border border-obsidian/10 bg-fog/60 p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-obsidian/40">
                Preview
              </p>
              <RichTextPreview value={raw} />
            </div>
          )}
        </div>
      )

    case 'markdown':
      return (
        <Textarea
          label={field.label}
          required={field.required}
          hint={field.help ?? 'Markdown is rendered by the site; do not paste HTML.'}
          error={error}
          counter={counter}
          maxLength={maxLength}
          rows={12}
          value={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
          className="font-mono text-[13px]"
        />
      )

    case 'number':
      return (
        <TextInput
          label={field.label}
          required={field.required}
          hint={field.help}
          error={error}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={typeof raw === 'number' ? raw : ''}
          disabled={disabled}
          onChange={(event) => {
            const text = event.target.value
            set(text === '' ? undefined : Number(text))
          }}
        />
      )

    case 'date':
      return (
        <TextInput
          label={field.label}
          required={field.required}
          hint={field.help}
          error={error}
          type="date"
          value={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          onChange={(event) => set(event.target.value || undefined)}
        />
      )

    case 'toggle':
      return (
        <div className={cn('rounded-card-lg border border-obsidian/10 p-4', error && 'border-obsidian')}>
          <Toggle
            label={field.label}
            description={field.help}
            checked={raw === true}
            disabled={disabled}
            onChange={set}
          />
          {error && <p className="mt-2 text-[12px] font-medium">{error}</p>}
        </div>
      )

    case 'select':
      return (
        <Select
          label={field.label}
          required={field.required}
          hint={field.help}
          error={error}
          options={field.options}
          placeholder="Choose…"
          value={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          onChange={(event) => set(event.target.value || undefined)}
        />
      )

    case 'multiselect': {
      const options = field.options ?? optionsFrom(lookups, field.optionsFrom)
      const selected = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-semibold">
            {field.label}
            {field.required && <span className="ml-1 text-obsidian/40" aria-hidden="true">*</span>}
          </legend>
          {field.help && <p className="-mt-1 text-[12px] leading-4 text-obsidian/55">{field.help}</p>}
          {options.length === 0 ? (
            <p className="text-[12px] text-obsidian/45">No options are available yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {options.map((option) => {
                const checked = selected.includes(option.value)
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-2 rounded-pill border px-3 py-2 text-[12px] font-medium transition-colors',
                      checked
                        ? 'border-obsidian bg-primary/35 text-obsidian'
                        : 'border-obsidian/15 bg-white text-obsidian/65 hover:border-obsidian/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      disabled={disabled}
                      onChange={() =>
                        set(
                          checked
                            ? selected.filter((value) => value !== option.value)
                            : [...selected, option.value],
                        )
                      }
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
          )}
          {error && <p className="text-[12px] font-medium">{error}</p>}
        </fieldset>
      )
    }

    case 'reference': {
      const options = referenceOptions(lookups, field.collection)
      return (
        <Select
          label={field.label}
          required={field.required}
          hint={field.help}
          error={error}
          options={options}
          placeholder={options.length === 0 ? 'No matching records yet' : 'Choose…'}
          value={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          onChange={(event) => set(event.target.value || undefined)}
        />
      )
    }

    case 'media':
      return (
        <MediaFieldInput
          label={field.label}
          value={asMedia(raw)}
          media={media}
          onMedia={onMedia}
          accept={(field.accept ?? 'any') as MediaAccept}
          disabled={disabled}
          onChange={set}
        />
      )

    case 'group':
      return (
        <fieldset className="rounded-card-lg border border-obsidian/10 bg-white p-4">
          <legend className="px-1 text-[13px] font-semibold">
            {field.label}
            {field.required && <span className="ml-1 text-obsidian/40" aria-hidden="true">*</span>}
          </legend>
          {field.help && <p className="mb-3 text-[12px] leading-4 text-obsidian/55">{field.help}</p>}
          <FieldEditor
            fields={field.fields}
            value={asRecord(raw)}
            onChange={set}
            errors={errors}
            prefix={path}
            media={media}
            onMedia={onMedia}
            lookups={lookups}
            disabled={disabled}
          />
        </fieldset>
      )

    case 'repeater':
      return (
        <RepeaterField
          field={field}
          path={path}
          raw={raw}
          errors={errors}
          media={media}
          onMedia={onMedia}
          lookups={lookups}
          disabled={disabled}
          onChange={set}
        />
      )

    case 'list':
      return (
        <ListField
          field={field}
          path={path}
          raw={raw}
          errors={errors}
          media={media}
          onMedia={onMedia}
          lookups={lookups}
          disabled={disabled}
          onChange={set}
        />
      )
  }
}

function RepeaterField({
  field,
  path,
  raw,
  errors,
  media,
  onMedia,
  lookups,
  disabled,
  onChange,
}: {
  field: Extract<FieldDef, { type: 'repeater' }>
  path: string
  raw: unknown
  errors: readonly FieldError[]
  media: MediaMap
  onMedia: (media: MediaView) => void
  lookups: Lookups | null
  disabled: boolean
  onChange: (next: unknown) => void
}) {
  const rows = asArray(raw)
  const max = field.max ?? 100

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[14px] font-semibold">
          {field.label}
          {field.required && <span className="ml-1 text-obsidian/40" aria-hidden="true">*</span>}
        </p>
        {field.help && <p className="mt-0.5 text-[12px] leading-4 text-obsidian/55">{field.help}</p>}
      </div>

      {rows.length === 0 && (
        <p className="rounded-card-lg border border-dashed border-obsidian/15 p-4 text-[12px] text-obsidian/45">
          No {field.itemLabel?.toLowerCase() ?? 'items'} yet.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={index} className="rounded-card-lg border border-obsidian/10 bg-fog/30 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-obsidian/45">
                {field.itemLabel ?? 'Item'} {index + 1}
              </p>
              {!disabled && (
                <RowControls
                  index={index}
                  count={rows.length}
                  onMove={(offset) => onChange(moveItem(rows, index, offset))}
                  onRemove={() => onChange(rows.filter((_, i) => i !== index))}
                />
              )}
            </div>
            <FieldEditor
              fields={field.fields}
              value={asRecord(row)}
              onChange={(next) => onChange(replaceItem(rows, index, next))}
              errors={errors}
              prefix={`${path}[${index}]`}
              media={media}
              onMedia={onMedia}
              lookups={lookups}
              disabled={disabled}
            />
          </div>
        ))}
      </div>

      {!disabled && (
        <div>
          <Button
            variant="outline"
            size="sm"
            icon={Plus}
            disabled={rows.length >= max}
            onClick={() => onChange([...rows, {}])}
          >
            Add {field.itemLabel?.toLowerCase() ?? 'item'}
          </Button>
          <span className="ml-3 text-[11px] text-obsidian/40">
            {rows.length}/{max}
          </span>
        </div>
      )}
    </div>
  )
}

function ListField({
  field,
  path,
  raw,
  errors,
  media,
  onMedia,
  lookups,
  disabled,
  onChange,
}: {
  field: Extract<FieldDef, { type: 'list' }>
  path: string
  raw: unknown
  errors: readonly FieldError[]
  media: MediaMap
  onMedia: (media: MediaView) => void
  lookups: Lookups | null
  disabled: boolean
  onChange: (next: unknown) => void
}) {
  const rows = asArray(raw)
  const max = field.max ?? 100
  const min = field.min ?? 0
  const error = directError(errors, path)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[14px] font-semibold">
          {field.label}
          {field.required && <span className="ml-1 text-obsidian/40" aria-hidden="true">*</span>}
        </p>
        {field.help && <p className="mt-0.5 text-[12px] leading-4 text-obsidian/55">{field.help}</p>}
      </div>

      {rows.length === 0 && (
        <p className="rounded-card-lg border border-dashed border-obsidian/15 p-4 text-[12px] text-obsidian/45">
          No items yet.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ListRowControl
                field={field}
                index={index}
                row={row}
                path={`${path}[${index}]`}
                errors={errors}
                media={media}
                onMedia={onMedia}
                lookups={lookups}
                disabled={disabled}
                onChange={(next) => onChange(replaceItem(rows, index, next))}
              />
            </div>
            {!disabled && (
              <RowControls
                index={index}
                count={rows.length}
                onMove={(offset) => onChange(moveItem(rows, index, offset))}
                onRemove={() => onChange(rows.filter((_, i) => i !== index))}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        {!disabled && (
          <Button
            variant="outline"
            size="sm"
            icon={Plus}
            disabled={rows.length >= max}
            onClick={() => onChange([...rows, emptyListItem(field)])}
          >
            Add item
          </Button>
        )}
        <span className={cn('text-[11px]', rows.length < min ? 'font-medium text-obsidian' : 'text-obsidian/40')}>
          {rows.length}/{max}
          {min > 0 && ` · minimum ${min}`}
        </span>
      </div>
      {error && <p className="text-[12px] font-medium">{error}</p>}
    </div>
  )
}

function ListRowControl({
  field,
  index,
  row,
  path,
  errors,
  media,
  onMedia,
  lookups,
  disabled,
  onChange,
}: {
  field: Extract<FieldDef, { type: 'list' }>
  index: number
  row: unknown
  path: string
  errors: readonly FieldError[]
  media: MediaMap
  onMedia: (media: MediaView) => void
  lookups: Lookups | null
  disabled: boolean
  onChange: (next: unknown) => void
}) {
  const error = directError(errors, path)

  if (field.of === 'link') {
    const link = asRecord(row)
    return (
      <div className="grid gap-2 rounded-card-lg border border-obsidian/10 bg-white p-2 sm:grid-cols-[1fr_1.4fr]">
        <TextInput
          aria-label={`Item ${index + 1} label`}
          placeholder="Label"
          value={typeof link.label === 'string' ? link.label : ''}
          disabled={disabled}
          error={error}
          onChange={(event) => onChange({ ...link, label: event.target.value })}
        />
        <TextInput
          aria-label={`Item ${index + 1} target`}
          placeholder="/path or https://…"
          value={typeof link.to === 'string' ? link.to : ''}
          disabled={disabled}
          onChange={(event) => onChange({ ...link, to: event.target.value })}
        />
      </div>
    )
  }

  if (field.of === 'media') {
    return (
      <div className="rounded-card-lg border border-obsidian/10 bg-white p-2">
        <MediaFieldInput
          value={asMedia(row)}
          media={media}
          onMedia={onMedia}
          accept="any"
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    )
  }

  if (field.of === 'reference') {
    const options = referenceOptions(lookups, field.collection ?? 'pages')
    return (
      <Select
        aria-label={`Item ${index + 1}`}
        options={options}
        placeholder={options.length === 0 ? 'No matching records yet' : 'Choose…'}
        value={typeof row === 'string' ? row : ''}
        disabled={disabled}
        error={error}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    )
  }

  if (field.of === 'number') {
    return (
      <TextInput
        aria-label={`Item ${index + 1}`}
        type="number"
        value={typeof row === 'number' ? row : ''}
        disabled={disabled}
        error={error}
        onChange={(event) => {
          const value = event.target.value
          onChange(value === '' ? undefined : Number(value))
        }}
      />
    )
  }

  return (
    <TextInput
      aria-label={`Item ${index + 1}`}
      placeholder="Text"
      value={typeof row === 'string' ? row : ''}
      disabled={disabled}
      error={error}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function RowControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number
  count: number
  onMove: (offset: number) => void
  onRemove: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/50 transition-colors hover:bg-fog hover:text-obsidian disabled:opacity-25"
      >
        <ChevronUp size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/50 transition-colors hover:bg-fog hover:text-obsidian disabled:opacity-25"
      >
        <ChevronDown size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label="Remove item"
        onClick={onRemove}
        className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/50 transition-colors hover:bg-obsidian hover:text-white"
      >
        <Trash2 size={14} strokeWidth={1.7} />
      </button>
    </div>
  )
}

function directError(errors: readonly FieldError[], path: string): string | undefined {
  return errors.find(
    (error) =>
      error.path === path ||
      error.path.startsWith(`${path}.`) ||
      error.path.startsWith(`${path}[`),
  )?.message
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asMedia(value: unknown): MediaValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.mediaId !== 'string') return undefined
  return {
    mediaId: record.mediaId,
    alt: typeof record.alt === 'string' ? record.alt : undefined,
  }
}

function replaceItem(rows: unknown[], index: number, next: unknown): unknown[] {
  const copy = [...rows]
  copy[index] = next
  return copy
}

function moveItem(rows: unknown[], index: number, offset: number): unknown[] {
  const next = index + offset
  if (next < 0 || next >= rows.length) return rows
  const copy = [...rows]
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item)
  return copy
}

function emptyListItem(field: Extract<FieldDef, { type: 'list' }>): unknown {
  if (field.of === 'link') return { label: '', to: '' }
  if (field.of === 'reference') return ''
  if (field.of === 'number') return 0
  if (field.of === 'media') return undefined
  return ''
}

function optionsFrom(
  lookups: Lookups | null,
  collection: string | undefined,
): { value: string; label: string }[] {
  if (!collection) return []
  return referenceOptions(lookups, collection)
}

function referenceOptions(
  lookups: Lookups | null,
  collection: string,
): { value: string; label: string }[] {
  if (!lookups) return []
  if (collection === 'pages') return lookups.pages
  if (collection === 'services') return lookups.services
  if (collection === 'projects') return lookups.projects
  if (collection === 'articles') return lookups.articles
  if (collection === 'testimonials') return lookups.testimonials
  if (collection === 'clients') return lookups.clients
  return []
}
