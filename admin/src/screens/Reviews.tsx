import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  GripVertical,
  Image as ImageIcon,
  MessageSquareQuote,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { api, errorMessage } from '../api/client'
import type {
  MediaView,
  ProjectView,
  ReviewDetailResponse,
  ReviewListResponse,
  ReviewView,
} from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import { MediaPicker } from '../components/MediaPicker'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  PanelHeading,
  SearchInput,
  Select,
  TextInput,
  Textarea,
  Toggle,
} from '../components/ui'

/*
 * Reviews (forms-reviews spec §11).
 *
 * One editorial list: the order is the site order, so drag-and-drop is the
 * primary reorder gesture and it writes the whole order back in one call.
 * Quotes are stored without surrounding quote marks; the preview adds them the
 * way the frontend does.
 */

type EditorState = {
  id: string | null
  quote: string
  authorName: string
  authorRole: string
  company: string
  avatar: string
  rating: string
  source: string
  sourceUrl: string
  reviewedAt: string
  isFeatured: boolean
  isVisible: boolean
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  quote: '',
  authorName: '',
  authorRole: '',
  company: '',
  avatar: '',
  rating: '',
  source: '',
  sourceUrl: '',
  reviewedAt: '',
  isFeatured: false,
  isVisible: true,
}

const SOURCE_OPTIONS = [
  { value: '', label: 'No source' },
  { value: 'direct', label: 'Direct' },
  { value: 'google', label: 'Google' },
  { value: 'clutch', label: 'Clutch' },
  { value: 'trustpilot', label: 'Trustpilot' },
  { value: 'other', label: 'Other' },
]

const RATING_OPTIONS = [
  { value: '', label: 'No rating' },
  { value: '1', label: '1 star' },
  { value: '2', label: '2 stars' },
  { value: '3', label: '3 stars' },
  { value: '4', label: '4 stars' },
  { value: '5', label: '5 stars' },
]

function editorFromReview(review: ReviewView): EditorState {
  return {
    id: review.id,
    quote: review.quote,
    authorName: review.authorName,
    authorRole: review.authorRole ?? '',
    company: review.company ?? '',
    avatar: review.avatar ?? '',
    rating: review.rating ? String(review.rating) : '',
    source: review.source ?? '',
    sourceUrl: review.sourceUrl ?? '',
    reviewedAt: review.reviewedAt ?? '',
    isFeatured: review.isFeatured,
    isVisible: review.isVisible,
  }
}

export default function Reviews() {
  const { me } = useAuth()
  const { push } = useToast()
  const { data, error, loading, reload } = useApi<ReviewListResponse>('/reviews')
  const projects = useApi<{ items: ProjectView[] }>('/api/admin/projects?limit=100')
  const canEdit = me?.capabilities.editContent ?? false
  const canDelete = me?.capabilities.deleteContent ?? false

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkAction, setBulkAction] = useState('hide')
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [deleteUsedBy, setDeleteUsedBy] = useState<{ id: string; title: string }[]>([])
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [order, setOrder] = useState<string[]>([])
  const [dragging, setDragging] = useState<string | null>(null)
  const dragOver = useRef<string | null>(null)

  const items = data?.items ?? []

  useEffect(() => {
    setOrder(items.map((item) => item.id))
  }, [data])

  const usedBy = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const project of projects.data?.items ?? []) {
      if (!project.reviewId) continue
      map.set(project.reviewId, [...(map.get(project.reviewId) ?? []), project.title ?? 'Untitled'])
    }
    return map
  }, [projects.data])

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    const byId = new Map(items.map((item) => [item.id, item]))
    const ordered = order.map((id) => byId.get(id)).filter((item): item is ReviewView => Boolean(item))
    if (!needle) return ordered
    return ordered.filter((item) =>
      [item.quote, item.authorName, item.company, item.authorRole]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [items, order, deferredQuery])

  const allSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.id))

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
    else setSelected(new Set(filtered.map((item) => item.id)))
  }

  async function patchReview(review: ReviewView, payload: Record<string, unknown>) {
    try {
      await api.put(`/reviews/${encodeURIComponent(review.id)}`, payload)
      push({ title: 'Review updated' })
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not update the review', description: errorMessage(cause) })
    }
  }

  function onDragStart(id: string) {
    setDragging(id)
  }

  function onDragOver(event: React.DragEvent, id: string) {
    event.preventDefault()
    dragOver.current = id
  }

  async function onDrop(event: React.DragEvent, targetId: string) {
    event.preventDefault()
    const sourceId = dragging
    setDragging(null)
    dragOver.current = null
    if (!sourceId || sourceId === targetId) return

    const next = [...order]
    const from = next.indexOf(sourceId)
    const to = next.indexOf(targetId)
    if (from < 0 || to < 0) return
    next.splice(from, 1)
    next.splice(to, 0, sourceId)
    setOrder(next)

    try {
      await api.put('/reviews/reorder', { ids: next })
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not save the order', description: errorMessage(cause) })
      reload()
    }
  }

  async function runBulk(action: string) {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      await api.post('/reviews/bulk', { ids: [...selected], action })
      push({ title: `${selected.size} review${selected.size === 1 ? '' : 's'} updated` })
      setSelected(new Set())
      setDeleteIds(null)
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'Bulk action failed', description: errorMessage(cause) })
    } finally {
      setBulkBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteIds) return
    setDeleteBusy(true)
    try {
      if (deleteIds.length === 1) {
        const response = await api.delete<{ ok: boolean; clearedProjects: number }>(
          `/reviews/${encodeURIComponent(deleteIds[0])}`,
        )
        push({
          title: 'Review deleted',
          description:
            response.clearedProjects > 0
              ? `${response.clearedProjects} project${response.clearedProjects === 1 ? '' : 's'} no longer show a testimonial.`
              : undefined,
        })
      } else {
        await api.post('/reviews/bulk', { ids: deleteIds, action: 'delete' })
        push({ title: `${deleteIds.length} reviews deleted` })
      }
      setDeleteIds(null)
      setDeleteUsedBy([])
      setSelected(new Set())
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not delete', description: errorMessage(cause) })
    } finally {
      setDeleteBusy(false)
    }
  }

  async function askDelete(ids: string[]) {
    setDeleteIds(ids)
    setDeleteUsedBy([])
    if (ids.length !== 1) return
    try {
      const response = await api.get<ReviewDetailResponse>(`/reviews/${encodeURIComponent(ids[0])}`)
      setDeleteUsedBy(response.usedBy)
    } catch {
      // The used-count from the list still tells the story.
    }
  }

  async function saveEditor() {
    if (!editor) return
    setSaving(true)
    try {
      const payload = {
        quote: editor.quote,
        authorName: editor.authorName,
        authorRole: editor.authorRole,
        company: editor.company,
        avatar: editor.avatar,
        rating: editor.rating ? Number(editor.rating) : null,
        source: editor.source,
        sourceUrl: editor.sourceUrl,
        reviewedAt: editor.reviewedAt,
        isFeatured: editor.isFeatured,
        isVisible: editor.isVisible,
      }
      if (editor.id) {
        await api.put(`/reviews/${encodeURIComponent(editor.id)}`, payload)
        push({ title: 'Review saved' })
      } else {
        await api.post('/reviews', payload)
        push({ title: 'Review added' })
      }
      setEditor(null)
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not save the review', description: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Reviews"
        description="Every quote on the site comes from this list, in this order. Drag a card to change where it appears."
        actions={
          canEdit ? (
            <Button icon={Plus} onClick={() => setEditor({ ...EMPTY_EDITOR })}>
              Add review
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search quote, author or company"
          className="max-w-[380px]"
        />
        <p className="text-[12px] text-obsidian/45">
          {items.length} review{items.length === 1 ? '' : 's'} ·{' '}
          {items.filter((item) => item.isVisible).length} visible
        </p>
      </div>

      {canEdit && selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-panel bg-obsidian px-5 py-3 text-white">
          <span className="text-[13px] font-semibold">{selected.size} selected</span>
          <select
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
            className="h-9 rounded-pill border border-white/20 bg-white/10 px-3 text-[12px] text-white"
            aria-label="Bulk action"
          >
            <option value="show" className="text-obsidian">
              Show
            </option>
            <option value="hide" className="text-obsidian">
              Hide
            </option>
            <option value="feature" className="text-obsidian">
              Feature
            </option>
            <option value="unfeature" className="text-obsidian">
              Unfeature
            </option>
            {canDelete && (
              <option value="delete" className="text-obsidian">
                Delete
              </option>
            )}
          </select>
          <Button
            variant="primary"
            size="sm"
            loading={bulkBusy}
            onClick={() => {
              if (bulkAction === 'delete') void askDelete([...selected])
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
          <LoadingRows rows={6} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={MessageSquareQuote}
            title={query ? 'No matching reviews' : 'No reviews yet'}
            description={
              query
                ? 'Try a different word from the quote, author or company.'
                : 'Add the first review and it will appear on the site in about a minute.'
            }
            action={
              canEdit && !query ? (
                <Button icon={Plus} onClick={() => setEditor({ ...EMPTY_EDITOR })}>
                  Add review
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((review) => (
            <li
              key={review.id}
              draggable={canEdit && !query}
              onDragStart={() => onDragStart(review.id)}
              onDragOver={(event) => onDragOver(event, review.id)}
              onDrop={(event) => void onDrop(event, review.id)}
              onDragEnd={() => setDragging(null)}
              className={[
                'flex items-start gap-3 rounded-panel bg-white p-4 shadow-soft transition-opacity sm:p-5',
                dragging === review.id ? 'opacity-45' : '',
                !review.isVisible ? 'bg-white/60' : '',
              ].join(' ')}
            >
              {canEdit && (
                <div className="flex flex-col items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={selected.has(review.id)}
                    onChange={() => toggle(review.id)}
                    aria-label={`Select review from ${review.authorName}`}
                    className="h-4 w-4 accent-obsidian"
                  />
                  <span
                    className="cursor-grab text-obsidian/25"
                    title="Drag to reorder"
                    aria-hidden="true"
                  >
                    <GripVertical size={16} strokeWidth={1.7} />
                  </span>
                </div>
              )}

              <div className="min-w-0 flex-1">
                <blockquote className="text-[14px] leading-7 text-obsidian/85">
                  <span aria-hidden="true">“</span>
                  {review.quote}
                  <span aria-hidden="true">”</span>
                </blockquote>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                  <span className="font-semibold">{review.authorName}</span>
                  {review.authorRole && <span className="text-obsidian/50">· {review.authorRole}</span>}
                  {review.company && <span className="text-obsidian/60">· {review.company}</span>}
                  {!review.isVisible && <Badge tone="outline">Hidden</Badge>}
                </div>
                {(usedBy.get(review.id)?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                      Used on
                    </span>
                    {(usedBy.get(review.id) ?? []).map((title) => (
                      <Badge key={title} tone="neutral">
                        {title}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-start">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => void patchReview(review, { isFeatured: !review.isFeatured })}
                  aria-pressed={review.isFeatured}
                  aria-label={review.isFeatured ? 'Remove from featured' : 'Feature review'}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/35 transition-colors hover:bg-fog hover:text-obsidian disabled:opacity-40"
                >
                  <Star
                    size={17}
                    strokeWidth={1.7}
                    className={review.isFeatured ? 'fill-obsidian text-obsidian' : ''}
                  />
                </button>
                <Toggle
                  checked={review.isVisible}
                  disabled={!canEdit}
                  onChange={(checked) => void patchReview(review, { isVisible: checked })}
                  label="Visible"
                />
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => setEditor(editorFromReview(review))}>
                    Edit
                  </Button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void askDelete([review.id])}
                    aria-label={`Delete review from ${review.authorName}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-obsidian/35 transition-colors hover:bg-fog hover:text-obsidian"
                  >
                    <Trash2 size={15} strokeWidth={1.7} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && filtered.length > 0 && (
        <div className="mt-3 flex items-center gap-3 px-2 text-[11px] text-obsidian/40">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Select all reviews"
            className="h-4 w-4 accent-obsidian"
          />
          Select all shown
        </div>
      )}

      <ReviewEditor
        state={editor}
        onClose={() => setEditor(null)}
        onChange={setEditor}
        onSave={() => void saveEditor()}
        saving={saving}
      />

      <ConfirmDialog
        open={deleteIds !== null}
        title={
          deleteIds && deleteIds.length > 1
            ? `Delete ${deleteIds.length} reviews?`
            : 'Delete this review?'
        }
        description={
          deleteUsedBy.length > 0
            ? `This review is used by ${deleteUsedBy.length} project${deleteUsedBy.length === 1 ? '' : 's'} (${deleteUsedBy
                .map((project) => project.title)
                .join(', ')}). Deleting it clears their testimonial. This cannot be undone.`
            : 'This cannot be undone. If a project points at this review, its testimonial is cleared.'
        }
        confirmLabel="Delete"
        loading={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          setDeleteIds(null)
          setDeleteUsedBy([])
        }}
      />
    </>
  )
}

function ReviewEditor({
  state,
  onClose,
  onChange,
  onSave,
  saving,
}: {
  state: EditorState | null
  onClose: () => void
  onChange: (state: EditorState) => void
  onSave: () => void
  saving: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setErrors({})
    setPickerOpen(false)
  }, [state?.id])

  if (!state) return null
  const current = state

  function set<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    onChange({ ...current, [key]: value })
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    const quote = current.quote.trim()
    if (!quote) next.quote = 'A review needs a quote'
    else if (quote.length > 800) next.quote = 'The quote is limited to 800 characters'
    const author = current.authorName.trim()
    if (!author) next.authorName = 'A review needs an author name'
    else if (author.length > 100) next.authorName = 'The author name is limited to 100 characters'
    if (current.sourceUrl.trim() && !/^https:\/\//.test(current.sourceUrl.trim())) {
      next.sourceUrl = 'The source URL must start with https://'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function submit() {
    if (!validate()) return
    onSave()
  }

  const previewQuote = state.quote.trim() || 'The quote preview appears here as you type.'
  const previewAuthor = state.authorName.trim() || 'Author name'

  return (
    <Modal
      open
      onClose={onClose}
      title={state.id ? 'Edit review' : 'Add review'}
      description="Quotes are stored without quote marks — the site adds them."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon={Save} loading={saving} onClick={submit}>
            {state.id ? 'Save review' : 'Add review'}
          </Button>
        </>
      }
    >
      <div className="grid gap-[25px] lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-4">
          <Textarea
            label="Quote"
            value={state.quote}
            error={errors.quote}
            onChange={(event) => set('quote', event.target.value)}
            rows={5}
            maxLength={800}
            counter={`${state.quote.length}/800`}
            placeholder="What did the client say?"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Author name"
              value={state.authorName}
              error={errors.authorName}
              maxLength={100}
              onChange={(event) => set('authorName', event.target.value)}
              placeholder="Holly"
            />
            <TextInput
              label="Role"
              value={state.authorRole}
              maxLength={100}
              onChange={(event) => set('authorRole', event.target.value)}
              placeholder="Marketing lead"
            />
            <TextInput
              label="Company"
              value={state.company}
              maxLength={100}
              onChange={(event) => set('company', event.target.value)}
              placeholder="Eventotron"
            />
            <Select
              label="Rating"
              value={state.rating}
              onChange={(event) => set('rating', event.target.value)}
              options={RATING_OPTIONS}
            />
            <Select
              label="Source"
              value={state.source}
              onChange={(event) => set('source', event.target.value)}
              options={SOURCE_OPTIONS}
            />
            <TextInput
              label="Source URL"
              value={state.sourceUrl}
              error={errors.sourceUrl}
              onChange={(event) => set('sourceUrl', event.target.value)}
              placeholder="https://"
              hint="Optional. Must start with https://"
            />
            <TextInput
              label="Reviewed on"
              value={state.reviewedAt}
              onChange={(event) => set('reviewedAt', event.target.value)}
              placeholder="2026-02-14"
            />
          </div>

          <div className="rounded-card-lg border border-obsidian/10 p-4">
            <p className="text-[13px] font-semibold">Avatar</p>
            <div className="mt-2 flex items-center gap-3">
              {state.avatar ? (
                <img
                  src={state.avatar}
                  alt=""
                  className="h-12 w-12 rounded-full bg-fog object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fog text-obsidian/35">
                  <ImageIcon size={18} strokeWidth={1.5} aria-hidden="true" />
                </span>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                  Choose image
                </Button>
                {state.avatar && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={X}
                    onClick={() => set('avatar', '')}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-obsidian/45">
              Optional. The current site design does not show avatars.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle
              checked={state.isFeatured}
              onChange={(checked) => set('isFeatured', checked)}
              label="Featured"
              description="Used by the home and services review sections."
            />
            <Toggle
              checked={state.isVisible}
              onChange={(checked) => set('isVisible', checked)}
              label="Visible"
              description="Hidden reviews stay here but never reach the site."
            />
          </div>
        </div>

        <div>
          <PanelHeading title="Live preview" description="Exactly how the quote card reads on the site." />
          <div className="rounded-panel bg-fog p-5">
            <p className="text-[15px] leading-7 text-obsidian">
              <span aria-hidden="true">“</span>
              {previewQuote}
              <span aria-hidden="true">”</span>
            </p>
            <div className="mt-4 flex items-center gap-3">
              {state.avatar && (
                <img src={state.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
              )}
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">{previewAuthor}</p>
                <p className="truncate text-[11px] text-obsidian/50">
                  {[state.authorRole, state.company].filter(Boolean).join(' · ') || 'Role · Company'}
                </p>
              </div>
              {state.isFeatured && (
                <Badge tone="mint" dot>
                  Featured
                </Badge>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-obsidian/45">
            The site shows quotes in this order, top to bottom.
          </p>
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        accept="image"
        onSelect={(media: MediaView) => {
          set('avatar', media.url)
          setPickerOpen(false)
        }}
      />
    </Modal>
  )
}
