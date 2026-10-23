import { useDeferredValue, useState } from 'react'
import { FileText, Film, Image as ImageIcon, ImageOff, Upload } from 'lucide-react'
import { Link } from 'react-router'
import type { MediaView } from '../api/types'
import { queryString } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Button, EmptyState, ErrorState, LoadingRows, Modal, SearchInput, TextInput, cn } from './ui'
import { formatBytes } from '../lib/format'

/*
 * Media thumbnails, the library picker, and the field control used inside the
 * schema-driven editor. A media field stores `{ mediaId, alt? }`; the thumbnail
 * comes from the API's media map, never from a URL stored in content.
 */

export function MediaThumb({
  media,
  className,
  alt,
  rounded = 'rounded-card-lg',
}: {
  media?: MediaView | null
  className?: string
  alt?: string
  rounded?: string
}) {
  if (!media) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-fog text-obsidian/30',
          rounded,
          className,
        )}
        aria-label="No media"
      >
        <ImageOff size={20} strokeWidth={1.5} aria-hidden="true" />
      </div>
    )
  }

  if (media.kind === 'image' || media.kind === 'svg') {
    return (
      <img
        src={media.url}
        alt={alt ?? media.alt}
        loading="lazy"
        className={cn('bg-fog object-cover', rounded, className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 bg-fog text-obsidian/45',
        rounded,
        className,
      )}
      aria-label={media.filename}
    >
      {media.kind === 'video' ? (
        <Film size={22} strokeWidth={1.4} aria-hidden="true" />
      ) : (
        <FileText size={22} strokeWidth={1.4} aria-hidden="true" />
      )}
      <span className="max-w-full truncate px-2 text-[10px]">{media.filename}</span>
    </div>
  )
}

const ACCEPT_LABEL = {
  image: 'image',
  video: 'video',
  any: 'file',
} as const

export type MediaAccept = keyof typeof ACCEPT_LABEL

function accepts(media: MediaView, accept: MediaAccept): boolean {
  if (accept === 'any') return true
  if (accept === 'video') return media.kind === 'video'
  return media.kind === 'image' || media.kind === 'svg'
}

export function MediaPicker({
  open,
  onClose,
  onSelect,
  accept = 'any',
  selectedId,
}: {
  open: boolean
  onClose: () => void
  onSelect: (media: MediaView) => void
  accept?: MediaAccept
  selectedId?: string
}) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const path = open
    ? `/media${queryString({ limit: 100, q: deferredQuery.trim() || undefined })}`
    : null
  const { data, loading, error, reload } = useApi<{ items: MediaView[] }>(path)
  const items = (data?.items ?? []).filter((item) => accepts(item, accept))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose media"
      description={`Showing ${ACCEPT_LABEL[accept]} files in the shared library.`}
      size="xl"
      footer={
        <>
          <Link to="/media" className="text-[12px] font-medium text-obsidian/55 hover:text-obsidian">
            Manage library
          </Link>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search by filename, alt text or tag"
          className="flex-1"
        />
        <span className="text-[12px] text-obsidian/45">{items.length} shown</span>
      </div>

      {loading ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={query ? 'No matching media' : 'The library is empty'}
          description={
            query
              ? 'Try a shorter search, or upload the file first.'
              : 'Upload an image or video from the Media screen, then choose it here.'
          }
          action={
            <Link to="/media" className="inline-flex h-11 items-center gap-2 rounded-button bg-primary px-6 text-sm font-medium">
              <Upload size={16} strokeWidth={1.7} aria-hidden="true" />
              Open media library
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((media) => (
            <li key={media.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(media)
                  onClose()
                }}
                className={cn(
                  'group flex w-full flex-col overflow-hidden rounded-card-lg border bg-white text-left transition-shadow duration-[350ms]',
                  selectedId === media.id
                    ? 'border-obsidian shadow-soft'
                    : 'border-obsidian/10 hover:shadow-soft',
                )}
              >
                <MediaThumb
                  media={media}
                  rounded="rounded-none"
                  className="aspect-[4/3] w-full"
                />
                <span className="flex w-full flex-col gap-0.5 px-3 py-2">
                  <span className="truncate text-[12px] font-semibold">{media.filename}</span>
                  <span className="text-[10px] text-obsidian/45">
                    {media.kind.toUpperCase()} · {formatBytes(media.size)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

export type MediaValue = { mediaId: string; alt?: string }

export function MediaFieldInput({
  value,
  onChange,
  media,
  onMedia,
  accept = 'any',
  disabled = false,
  label = 'Media',
}: {
  value: MediaValue | undefined
  onChange: (value: MediaValue | undefined) => void
  media: Record<string, MediaView>
  onMedia: (media: MediaView) => void
  accept?: MediaAccept
  disabled?: boolean
  label?: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const selected = value?.mediaId ? media[value.mediaId] : undefined

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-[13px] font-semibold">{label}</p>}
      <div className="flex flex-col gap-3 rounded-card-lg border border-obsidian/10 bg-fog/60 p-3 sm:flex-row sm:items-start">
        <MediaThumb media={selected} className="h-[92px] w-full shrink-0 sm:w-[124px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {selected ? (
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{selected.filename}</p>
              <p className="text-[11px] text-obsidian/45">
                {selected.kind.toUpperCase()} · {formatBytes(selected.size)}
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-obsidian/50">
              {value?.mediaId ? 'This media id is missing from the library.' : 'No file selected.'}
            </p>
          )}

          <TextInput
            label="Alt text override"
            value={value?.alt ?? selected?.alt ?? ''}
            disabled={disabled || !value?.mediaId}
            maxLength={300}
            placeholder={selected?.alt || 'Describe the image for screen readers'}
            onChange={(event) =>
              onChange(value ? { ...value, alt: event.target.value } : undefined)
            }
          />

          {!disabled && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                {selected ? 'Replace' : 'Choose media'}
              </Button>
              {value?.mediaId && (
                <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        accept={accept}
        selectedId={value?.mediaId}
        onSelect={(chosen) => {
          onMedia(chosen)
          // A new file has its own library alt text; carrying over an override
          // from the previous file is almost always wrong.
          onChange({ mediaId: chosen.id })
        }}
      />
    </div>
  )
}
