import type { ReactNode } from 'react'
import { ExternalLink, RotateCcw, Save, Send, Trash2, Undo2 } from 'lucide-react'
import type { FieldError } from '../api/types'
import {
  Badge,
  Button,
  ErrorState,
  FieldErrors,
  PageHeader,
  Panel,
  StatusBadge,
} from './ui'
import { formatDateTime } from '../lib/format'

/*
 * Shared chrome around a document or entry editor. It is deliberately dumb:
 * the screen owns fetching and mutations, this owns the header, dirty bar,
 * lifecycle buttons and the delete zone.
 */

export function EditorFrame({
  backTo,
  backLabel,
  eyebrow,
  title,
  description,
  status,
  changed,
  hasPublished,
  version,
  updatedAt,
  publishedAt,
  viewHref,
  canEdit,
  canPublish,
  canDelete,
  saving,
  publishing,
  dirty,
  error,
  fieldErrors,
  onSave,
  onPublish,
  onUnpublish,
  onRevert,
  onDelete,
  children,
  titleAdornment,
}: {
  backTo: string
  backLabel: string
  eyebrow?: string
  title: string
  description?: string
  status: string
  changed: boolean
  hasPublished: boolean
  version: number
  updatedAt: string
  publishedAt: string | null
  viewHref?: string
  canEdit: boolean
  canPublish: boolean
  canDelete: boolean
  saving: boolean
  publishing: boolean
  dirty: boolean
  error: Error | null
  fieldErrors: readonly FieldError[]
  onSave: () => void
  onPublish: () => void
  onUnpublish: () => void
  onRevert: () => void
  onDelete: () => void
  children: ReactNode
  titleAdornment?: ReactNode
}) {
  return (
    <>
      <PageHeader
        backTo={backTo}
        backLabel={backLabel}
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <>
            {viewHref && status === 'published' && (
              <a
                href={viewHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-button border border-obsidian/15 bg-white px-5 text-sm font-medium text-obsidian transition-colors hover:bg-fog"
              >
                <ExternalLink size={15} strokeWidth={1.7} aria-hidden="true" />
                View
              </a>
            )}
            {canEdit && hasPublished && changed && (
              <Button
                variant="ghost"
                icon={RotateCcw}
                onClick={onRevert}
                disabled={saving || publishing}
              >
                Revert
              </Button>
            )}
            {canPublish && status === 'published' && (
              <Button
                variant="outline"
                icon={Undo2}
                onClick={onUnpublish}
                disabled={saving || publishing}
              >
                Unpublish
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                icon={Save}
                loading={saving}
                onClick={onSave}
                disabled={publishing}
              >
                Save draft
              </Button>
            )}
            {canPublish && (
              <Button
                icon={Send}
                loading={publishing}
                onClick={onPublish}
                disabled={saving}
              >
                {status === 'published' ? 'Publish changes' : 'Publish'}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={status} changed={changed} hasPublished={hasPublished} />
        <Badge tone="outline">v{version}</Badge>
        <span className="text-[12px] text-obsidian/45">Updated {formatDateTime(updatedAt)}</span>
        {publishedAt && (
          <span className="text-[12px] text-obsidian/45">· Published {formatDateTime(publishedAt)}</span>
        )}
        {titleAdornment}
      </div>

      {dirty && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-card-lg bg-secondary/35 px-4 py-3 text-[12px] font-medium text-obsidian">
          <span>Unsaved changes</span>
          {canEdit && <span className="text-obsidian/55">Save the draft before leaving.</span>}
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorState error={error} compact />
        </div>
      )}

      {fieldErrors.length > 0 && (
        <div className="mb-4">
          <FieldErrors errors={[...fieldErrors]} />
        </div>
      )}

      <div className="flex flex-col gap-[25px]">{children}</div>

      {canDelete && (
        <Panel className="mt-[25px] border border-obsidian/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-[15px] font-bold">Delete this record</h3>
              <p className="mt-1 text-[12px] leading-5 text-obsidian/55">
                This removes it from the CMS and the public API. The action is logged and cannot be
                undone from this screen.
              </p>
            </div>
            <Button variant="danger" icon={Trash2} onClick={onDelete}>
              Delete
            </Button>
          </div>
        </Panel>
      )}
    </>
  )
}
