import { useEffect, useRef, useState } from 'react'
import {
  Copy,
  FileText,
  Film,
  Image as ImageIcon,
  Play,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { Link } from 'react-router'
import {
  ApiError,
  api,
  errorMessage,
  queryString,
  uploadMedia,
} from '../api/client'
import type { MediaUsage, MediaView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import { MediaPicker, MediaThumb } from '../components/MediaPicker'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingRows,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Tabs,
  TextInput,
  Textarea,
  cn,
} from '../components/ui'
import { formatBytes, formatDate } from '../lib/format'

/*
 * Media library. The grid is the default view; clicking a card opens an edit
 * drawer with alt text, crop focus, tags, usage and delete. Uploads show real
 * progress via XHR because fetch cannot report request progress.
 */

const TAB_ITEMS = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'file', label: 'Files' },
] as const

type MediaListResponse = { items: MediaView[]; total: number; page: number; limit: number }
type MediaDetailResponse = { item: MediaView; usage: MediaUsage[] }

export default function Media() {
  const { me } = useAuth()
  const { push } = useToast()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(1)
  const path = `/media${queryString({
    q: query.trim() || undefined,
    kind: kind === 'all' ? undefined : kind,
    page,
    limit: 24,
  })}`
  const { data, error, loading, reload } = useApi<MediaListResponse>(path)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const canUpload = me?.capabilities.upload ?? false
  const canDelete = me?.capabilities.deleteContent ?? false

  async function handleFiles(files: File[]) {
    if (files.length === 0 || !canUpload) return
    setUploadError(null)
    setProgress(0)
    try {
      const response = await uploadMedia(files, setProgress)
      push({
        title: `${response.items.length} file${response.items.length === 1 ? '' : 's'} uploaded`,
        description: 'Set alt text and focus before using them in a page.',
      })
      setPage(1)
      reload()
    } catch (cause) {
      setUploadError(errorMessage(cause))
    } finally {
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Media"
        description="One shared R2 bucket for the CMS and the site. Files are immutable once uploaded; alt text and focus can change at any time."
        actions={
          canUpload ? (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf"
                className="sr-only"
                onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))}
              />
              <Button icon={UploadCloud} onClick={() => inputRef.current?.click()}>
                Upload files
              </Button>
            </>
          ) : undefined
        }
      />

      {canUpload && (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void handleFiles(Array.from(event.dataTransfer.files))
          }}
          className={cn(
            'mb-[25px] flex flex-col items-center justify-center rounded-panel border border-dashed px-6 py-8 text-center transition-colors',
            dragging ? 'border-obsidian bg-primary/15' : 'border-obsidian/25 bg-white/60',
          )}
        >
          <UploadCloud size={26} strokeWidth={1.4} className="mb-2 text-obsidian/45" aria-hidden="true" />
          <p className="text-[13px] font-semibold">Drop files here to upload</p>
          <p className="mt-1 text-[11px] text-obsidian/45">
            JPG, PNG, WebP, AVIF, SVG, MP4, WebM, MOV or PDF · 10 MB per file
          </p>
          {progress !== null && (
            <div className="mt-4 w-full max-w-[360px]" role="status">
              <div className="h-2 overflow-hidden rounded-pill bg-fog">
                <div
                  className="h-full rounded-pill bg-primary transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] tabular-nums text-obsidian/45">Uploading {progress}%</p>
            </div>
          )}
          {uploadError && <p className="mt-3 text-[12px] font-medium" role="alert">{uploadError}</p>}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <SearchInput
          value={query}
          onChange={(value) => {
            setQuery(value)
            setPage(1)
          }}
          placeholder="Search media"
          className="max-w-[380px]"
        />
        <Tabs
          value={kind}
          onChange={(value) => {
            setKind(value)
            setPage(1)
          }}
          items={TAB_ITEMS}
        />
      </div>

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
            icon={ImageIcon}
            title={query ? 'No matching media' : 'The library is empty'}
            description={
              query
                ? 'Try another search or clear the kind filter.'
                : 'Upload the images and video the site needs, then reference them from the editor.'
            }
            action={
              canUpload ? (
                <Button icon={UploadCloud} onClick={() => inputRef.current?.click()}>
                  Upload files
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <ul className="grid gap-[25px] sm:grid-cols-2 xl:grid-cols-3">
            {data?.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setDetailId(item.id)}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-panel bg-white text-left shadow-soft transition-shadow duration-[350ms] hover:shadow-float"
                >
                  <div className="relative">
                    <MediaThumb media={item} rounded="rounded-none" className="aspect-[16/10] w-full" />
                    <span className="absolute left-3 top-3">
                      <Badge tone={item.kind === 'video' ? 'dark' : 'neutral'}>
                        {item.kind === 'video' ? (
                          <Film size={11} strokeWidth={1.8} />
                        ) : item.kind === 'file' ? (
                          <FileText size={11} strokeWidth={1.8} />
                        ) : (
                          <ImageIcon size={11} strokeWidth={1.8} />
                        )}
                        {item.kind.toUpperCase()}
                      </Badge>
                    </span>
                    {item.kind === 'video' && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-obsidian">
                          <Play size={17} strokeWidth={1.8} />
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <p className="truncate text-[13px] font-semibold">{item.filename}</p>
                    <p className="truncate text-[11px] text-obsidian/45">
                      {item.alt || 'No alt text'}
                    </p>
                    <p className="mt-auto pt-2 text-[10px] text-obsidian/40">
                      {formatBytes(item.size)} · {formatDate(item.createdAt)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {data && (
            <div className="mt-4">
              <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
            </div>
          )}
        </>
      )}

      <MediaDetail
        key={detailId ?? 'closed'}
        id={detailId}
        canDelete={canDelete}
        canEdit={canUpload}
        onClose={() => setDetailId(null)}
        onChanged={() => reload()}
      />
    </>
  )
}

function MediaDetail({
  id,
  canDelete,
  canEdit,
  onClose,
  onChanged,
}: {
  id: string | null
  canDelete: boolean
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { push } = useToast()
  const { data, error, loading, setData, reload } = useApi<MediaDetailResponse>(id ? `/media/${id}` : null)
  const [alt, setAlt] = useState('')
  const [tags, setTags] = useState('')
  const [focusX, setFocusX] = useState(0.5)
  const [focusY, setFocusY] = useState(0.5)
  const [hasFocus, setHasFocus] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [posterId, setPosterId] = useState<string | null>(null)
  const [posterOpen, setPosterOpen] = useState(false)
  const [posterLabel, setPosterLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    setAlt(data.item.alt)
    setTags(data.item.tags.join(', '))
    setFocusX(data.item.focus?.x ?? 0.5)
    setFocusY(data.item.focus?.y ?? 0.5)
    setHasFocus(Boolean(data.item.focus))
    setPosterId(data.item.posterId)
    setPosterLabel(null)
    setSaveError(null)
  }, [data])

  async function save() {
    if (!id) return
    setSaving(true)
    setSaveError(null)
    try {
      const response = await api.patch<MediaDetailResponse>(`/media/${id}`, {
        alt,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        focus: hasFocus ? { x: focusX, y: focusY } : null,
        posterId,
      })
      setData(response)
      onChanged()
      push({ title: 'Media updated' })
    } catch (cause) {
      setSaveError(errorMessage(cause))
      if (cause instanceof ApiError && cause.status === 409) setDeleteOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!id) return
    setDeleting(true)
    try {
      await api.delete(`/media/${id}`)
      push({ title: 'Media deleted' })
      setDeleteOpen(false)
      onClose()
      onChanged()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not delete the file', description: errorMessage(cause) })
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  const item = data?.item

  return (
    <>
      <Modal
        open={id !== null}
        onClose={onClose}
        title={item?.filename ?? 'Media'}
        description={item ? `${item.kind.toUpperCase()} · ${formatBytes(item.size)}` : undefined}
        size="lg"
        footer={
          <>
            {item && (
              <Button
                variant="ghost"
                icon={Copy}
                onClick={() => {
                  void navigator.clipboard.writeText(item.url).then(
                    () => push({ title: 'URL copied' }),
                    () => push({ tone: 'error', title: 'Could not copy the URL' }),
                  )
                }}
              >
                Copy URL
              </Button>
            )}
            {canDelete && item && (
              <Button variant="danger" icon={Trash2} onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Close
            </Button>
            {canEdit && (
              <Button loading={saving} onClick={() => void save()}>
                Save changes
              </Button>
            )}
          </>
        }
      >
        {loading && !data ? (
          <LoadingRows rows={5} />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : item ? (
          <div className="flex flex-col gap-5">
            <div className="relative overflow-hidden rounded-card-lg">
              <MediaThumb media={item} rounded="rounded-none" className="aspect-video w-full" />
              {hasFocus && (
                <span
                  className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-obsidian shadow-float"
                  style={{ left: `${focusX * 100}%`, top: `${focusY * 100}%` }}
                  aria-hidden="true"
                />
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="Alt text"
                value={alt}
                maxLength={300}
                disabled={!canEdit}
                onChange={(event) => setAlt(event.target.value)}
                hint="Describe the content, not the file name."
              />
              <TextInput
                label="Tags"
                value={tags}
                disabled={!canEdit}
                onChange={(event) => setTags(event.target.value)}
                hint="Comma separated, e.g. team, office."
              />
            </div>

            <div className="rounded-card-lg border border-obsidian/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold">Crop focus</p>
                  <p className="mt-0.5 text-[11px] text-obsidian/50">
                    Used by object-position when the site crops this file.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setHasFocus((value) => !value)} disabled={!canEdit}>
                  {hasFocus ? 'Clear focus' : 'Set focus'}
                </Button>
              </div>
              {hasFocus && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[12px]">
                    <span className="font-medium">Horizontal {focusX.toFixed(2)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={focusX}
                      disabled={!canEdit}
                      onChange={(event) => setFocusX(Number(event.target.value))}
                      className="accent-obsidian"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px]">
                    <span className="font-medium">Vertical {focusY.toFixed(2)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={focusY}
                      disabled={!canEdit}
                      onChange={(event) => setFocusY(Number(event.target.value))}
                      className="accent-obsidian"
                    />
                  </label>
                </div>
              )}
            </div>

            {item.kind === 'video' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card-lg border border-obsidian/10 p-4">
                <div>
                  <p className="text-[13px] font-semibold">Poster frame</p>
                  <p className="mt-0.5 text-[11px] text-obsidian/50">
                    {posterId ? posterLabel ?? 'A poster is selected.' : 'Optional still shown before playback.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => setPosterOpen(true)}>
                    Choose poster
                  </Button>
                  {posterId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit}
                      onClick={() => {
                        setPosterId(null)
                        setPosterLabel(null)
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            )}

            <Textarea
              label="Usage"
              readOnly
              value={
                data?.usage.length
                  ? data.usage
                      .map((usage) =>
                        usage.kind === 'document'
                          ? `${usage.title} (${usage.type})`
                          : `${usage.label} (${usage.collection})`,
                      )
                      .join('\n')
                  : 'Not referenced by any record.'
              }
              hint="A file referenced by a draft or a published record cannot be deleted."
              className="min-h-[84px] font-mono text-[12px]"
            />

            {data?.usage.length ? (
              <ul className="flex flex-wrap gap-2">
                {data.usage.map((usage) =>
                  usage.kind === 'document' ? (
                    <li key={`doc-${usage.slug}`}>
                      <Link
                        to={`/pages/${usage.slug}`}
                        className="inline-flex items-center gap-1 rounded-pill bg-fog px-3 py-1.5 text-[11px] font-medium hover:bg-secondary/40"
                      >
                        {usage.title}
                      </Link>
                    </li>
                  ) : (
                    <li key={`entry-${usage.id}`}>
                      <Link
                        to={`/collections/${usage.collection}/${usage.id}`}
                        className="inline-flex items-center gap-1 rounded-pill bg-fog px-3 py-1.5 text-[11px] font-medium hover:bg-secondary/40"
                      >
                        {usage.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            ) : null}

            {saveError && (
              <p role="alert" className="text-[12px] font-medium">
                {saveError}
              </p>
            )}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this file?"
        description={
          data?.usage.length
            ? `This file is used by ${data.usage.length} record(s). Remove those references first.`
            : 'The file is soft-deleted and disappears from the library. The R2 object is retained for recovery.'
        }
        confirmLabel="Delete file"
        loading={deleting}
        onConfirm={() => void remove()}
        onClose={() => setDeleteOpen(false)}
      />

      <MediaPicker
        open={posterOpen}
        onClose={() => setPosterOpen(false)}
        accept="image"
        selectedId={posterId ?? undefined}
        onSelect={(media) => {
          setPosterId(media.id)
          setPosterLabel(media.filename)
        }}
      />
    </>
  )
}
