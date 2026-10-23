import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { COLLECTIONS, isCollectionName, type CollectionName } from '@marino/content-schema'
import { ApiError, api } from '../api/client'
import type { EntryResponse, EntryView, FieldError, Lookups, MediaMap, MediaView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import { EditorFrame } from '../components/EditorFrame'
import { FieldEditor } from '../components/FieldEditor'
import { ConfirmDialog, ErrorState, LoadingRows, PageHeader, Panel, PanelHeading } from '../components/ui'
import { entryTitle } from '../lib/format'

/*
 * Entry editor. Same schema-driven body as a document, keyed by the collection
 * discriminator. The published snapshot is what the public collection endpoint
 * serves; the draft is never visible to the site.
 */

const LABELS: Record<CollectionName, string> = {
  services: 'Services',
  projects: 'Projects',
  testimonials: 'Testimonials',
  clients: 'Clients',
  articles: 'Articles',
}

export default function EntryEditor() {
  const { name = '', id = '' } = useParams<{ name: string; id: string }>()
  const collection = isCollectionName(name) ? name : null
  const navigate = useNavigate()
  const { me } = useAuth()
  const { push } = useToast()
  const { data, error, loading, setData, reload } = useApi<EntryResponse>(
    collection && id ? `/entries/${collection}/${encodeURIComponent(id)}` : null,
  )
  const lookups = useApi<Lookups>('/lookups')

  const [item, setItem] = useState<EntryView | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [media, setMedia] = useState<MediaMap>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [actionError, setActionError] = useState<Error | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [confirm, setConfirm] = useState<'unpublish' | 'revert' | 'delete' | null>(null)
  const [confirming, setConfirming] = useState(false)

  useUnsavedChanges(dirty)

  useEffect(() => {
    if (!data) return
    setItem(data.item)
    setDraft(data.item.data)
    setMedia((current) => ({ ...data.media, ...current }))
    setFieldErrors([])
    setActionError(null)
    setDirty(false)
  }, [data])

  const definition = useMemo(() => {
    if (!collection) return null
    return COLLECTIONS[collection]
  }, [collection])

  if ((loading && !data) || (data && !item)) {
    return (
      <Panel>
        <LoadingRows rows={8} />
      </Panel>
    )
  }

  if (!collection || ((error && !data) || !item)) {
    return (
      <>
        <PageHeader
          backTo={collection ? `/collections/${collection}` : '/pages'}
          backLabel={collection ? LABELS[collection] : 'Pages'}
          eyebrow="Entry"
          title="Entry not found"
        />
        <Panel>
          <ErrorState
            error={error ?? new Error('This entry does not exist or you do not have access.')}
            onRetry={reload}
          />
        </Panel>
      </>
    )
  }

  const canEdit = me?.capabilities.editContent ?? false
  const canPublish = me?.capabilities.publish ?? false
  const canDelete = me?.capabilities.deleteContent ?? false
  const label = LABELS[collection]

  function changeDraft(next: Record<string, unknown>) {
    setDraft(next)
    setDirty(true)
    setFieldErrors([])
    setActionError(null)
  }

  function addMedia(next: MediaView) {
    setMedia((current) => ({ ...current, [next.id]: next }))
  }

  function captureError(cause: unknown) {
    setActionError(cause instanceof Error ? cause : new Error(String(cause)))
    if (cause instanceof ApiError) setFieldErrors(cause.fields)
  }

  async function persistDraft(): Promise<EntryResponse | null> {
    if (!item || !collection) return null
    setSaving(true)
    setActionError(null)
    setFieldErrors([])
    try {
      const response = await api.put<EntryResponse>(
        `/entries/${collection}/${encodeURIComponent(item.id)}`,
        { data: draft, expectedVersion: item.version },
      )
      setData(response)
      push({ title: 'Draft saved', description: entryTitle(response.item.data) })
      return response
    } catch (cause) {
      captureError(cause)
      return null
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    if (!item || !collection) return
    setPublishing(true)
    setActionError(null)
    setFieldErrors([])
    try {
      let version = item.version
      if (dirty) {
        const saved = await persistDraft()
        if (!saved) return
        version = saved.item.version
      }
      const response = await api.post<EntryResponse>(
        `/entries/${collection}/${encodeURIComponent(item.id)}/publish`,
        { expectedVersion: version },
      )
      setData(response)
      push({ title: 'Published', description: entryTitle(response.item.data) })
    } catch (cause) {
      captureError(cause)
    } finally {
      setPublishing(false)
    }
  }

  async function runConfirmed() {
    if (!item || !collection || !confirm) return
    setConfirming(true)
    setActionError(null)
    try {
      if (confirm === 'unpublish') {
        const response = await api.post<EntryResponse>(
          `/entries/${collection}/${encodeURIComponent(item.id)}/unpublish`,
          { expectedVersion: item.version },
        )
        setData(response)
        push({ title: 'Unpublished', description: entryTitle(response.item.data) })
      } else if (confirm === 'revert') {
        const response = await api.post<EntryResponse>(
          `/entries/${collection}/${encodeURIComponent(item.id)}/revert`,
          { expectedVersion: item.version },
        )
        setData(response)
        push({ title: 'Reverted to the published snapshot' })
      } else {
        await api.delete(`/entries/${collection}/${encodeURIComponent(item.id)}`)
        push({ title: `${label.replace(/s$/, '')} deleted` })
        setDirty(false)
        navigate(`/collections/${collection}`)
      }
      setConfirm(null)
    } catch (cause) {
      captureError(cause)
      setConfirm(null)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <>
      <EditorFrame
        backTo={`/collections/${collection}`}
        backLabel={label}
        eyebrow={label}
        title={entryTitle(draft, 'Untitled entry')}
        description={
          item.slug
            ? `Editing /${item.slug}.`
            : 'This entry has no slug; the collection displays it by its content.'
        }
        status={item.status}
        changed={item.changed}
        hasPublished={item.hasPublished}
        version={item.version}
        updatedAt={item.updatedAt}
        publishedAt={item.publishedAt}
        viewHref={viewHref(collection, draft, me?.siteOrigin)}
        canEdit={canEdit}
        canPublish={canPublish}
        canDelete={canDelete}
        saving={saving}
        publishing={publishing}
        dirty={dirty}
        error={actionError}
        fieldErrors={fieldErrors}
        onSave={() => void persistDraft()}
        onPublish={() => void publish()}
        onUnpublish={() => setConfirm('unpublish')}
        onRevert={() => setConfirm('revert')}
        onDelete={() => setConfirm('delete')}
      >
        <Panel>
          <PanelHeading
            title="Entry"
            description="Order and slug are part of the schema. Required fields are marked with an asterisk."
          />
          {definition ? (
            <FieldEditor
              fields={definition.fields}
              value={draft}
              onChange={changeDraft}
              errors={fieldErrors}
              media={media}
              onMedia={addMedia}
              lookups={lookups.data}
              disabled={!canEdit}
            />
          ) : (
            <p className="text-[13px] text-obsidian/55">Unknown collection.</p>
          )}
        </Panel>
      </EditorFrame>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'delete'
            ? 'Delete this entry?'
            : confirm === 'unpublish'
              ? 'Unpublish this entry?'
              : 'Discard unpublished changes?'
        }
        description={
          confirm === 'delete'
            ? 'The entry and its draft will be removed. The public collection stops serving it immediately.'
            : confirm === 'unpublish'
              ? 'The public collection stops serving it immediately. The snapshot is kept for re-publishing.'
              : 'The draft is replaced by the last published snapshot. This cannot be undone.'
        }
        confirmLabel={
          confirm === 'delete' ? 'Delete entry' : confirm === 'unpublish' ? 'Unpublish' : 'Revert draft'
        }
        loading={confirming}
        onConfirm={() => void runConfirmed()}
        onClose={() => setConfirm(null)}
      />
    </>
  )
}

function viewHref(
  collection: CollectionName,
  data: Record<string, unknown>,
  siteOrigin: string | undefined,
): string | undefined {
  if (!siteOrigin) return undefined
  const base = siteOrigin.replace(/\/+$/, '')
  const slug = typeof data.slug === 'string' ? data.slug : ''

  if (collection === 'projects' && slug) return `${base}/work/${slug}`
  if (collection === 'articles' && slug) return `${base}/blog/${slug}`
  if (collection === 'services') {
    const pageSlug = typeof data.pageSlug === 'string' ? data.pageSlug : ''
    return pageSlug ? `${base}/${pageSlug}` : `${base}/services`
  }
  return undefined
}
