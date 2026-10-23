import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { DOCUMENTS, isDocumentType } from '@marino/content-schema'
import { ApiError, api } from '../api/client'
import type { DocumentResponse, DocumentView, FieldError, Lookups, MediaMap, MediaView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import { EditorFrame } from '../components/EditorFrame'
import { FieldEditor } from '../components/FieldEditor'
import {
  ConfirmDialog,
  ErrorState,
  LoadingRows,
  PageHeader,
  Panel,
  PanelHeading,
  TextInput,
} from '../components/ui'

/*
 * Document editor. The form body is generated from the document's FieldDef
 * catalog, so every singleton and every page share one editor.
 */

const SETTINGS_SLUGS = new Set(['_site', '_navigation', '_footer'])

export default function DocumentEditor() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { me } = useAuth()
  const { push } = useToast()
  const { data, error, loading, setData, reload } = useApi<DocumentResponse>(
    slug ? `/documents/${encodeURIComponent(slug)}` : null,
  )
  const lookups = useApi<Lookups>('/lookups')

  const [item, setItem] = useState<DocumentView | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [internalTitle, setInternalTitle] = useState('')
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
    setInternalTitle(data.item.title)
    setMedia((current) => ({ ...data.media, ...current }))
    setFieldErrors([])
    setActionError(null)
    setDirty(false)
  }, [data])

  const definition = useMemo(() => {
    if (!item || !isDocumentType(item.type)) return null
    return DOCUMENTS[item.type]
  }, [item])

  if ((loading && !data) || (data && !item)) {
    return (
      <Panel>
        <LoadingRows rows={8} />
      </Panel>
    )
  }

  if ((error && !data) || !item) {
    return (
      <>
        <PageHeader backTo="/pages" backLabel="Pages" eyebrow="Document" title="Document not found" />
        <Panel>
          <ErrorState error={error ?? new Error('This document does not exist.')} onRetry={reload} />
        </Panel>
      </>
    )
  }

  const canEdit = (me?.capabilities.editContent ?? false) &&
    (!SETTINGS_SLUGS.has(item.slug) || (me?.capabilities.manageSettings ?? false))
  const canPublish = (me?.capabilities.publish ?? false) &&
    (!SETTINGS_SLUGS.has(item.slug) || (me?.capabilities.manageSettings ?? false))
  const canDelete = me?.capabilities.deleteContent ?? false

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

  async function persistDraft(): Promise<DocumentResponse | null> {
    if (!item) return null
    setSaving(true)
    setActionError(null)
    setFieldErrors([])
    try {
      const response = await api.put<DocumentResponse>(`/documents/${encodeURIComponent(item.slug)}`, {
        data: draft,
        title: internalTitle,
        expectedVersion: item.version,
      })
      setData(response)
      push({ title: 'Draft saved', description: response.item.title })
      return response
    } catch (cause) {
      captureError(cause)
      return null
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    if (!item) return
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
      const response = await api.post<DocumentResponse>(
        `/documents/${encodeURIComponent(item.slug)}/publish`,
        { expectedVersion: version },
      )
      setData(response)
      push({ title: 'Published', description: response.item.title })
    } catch (cause) {
      captureError(cause)
    } finally {
      setPublishing(false)
    }
  }

  async function runConfirmed() {
    if (!item || !confirm) return
    setConfirming(true)
    setActionError(null)
    try {
      if (confirm === 'unpublish') {
        const response = await api.post<DocumentResponse>(
          `/documents/${encodeURIComponent(item.slug)}/unpublish`,
          { expectedVersion: item.version },
        )
        setData(response)
        push({ title: 'Unpublished', description: response.item.title })
      } else if (confirm === 'revert') {
        const response = await api.post<DocumentResponse>(
          `/documents/${encodeURIComponent(item.slug)}/revert`,
          { expectedVersion: item.version },
        )
        setData(response)
        push({ title: 'Reverted to the published snapshot' })
      } else {
        await api.delete(`/documents/${encodeURIComponent(item.slug)}`)
        push({ title: 'Page deleted', description: item.title })
        setDirty(false)
        navigate('/pages')
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
        backTo="/pages"
        backLabel="Pages"
        eyebrow={definition?.label ?? item.type}
        title={internalTitle || item.title}
        description={
          SETTINGS_SLUGS.has(item.slug) && !me?.capabilities.manageSettings
            ? 'Read-only. Site identity, navigation and footer are restricted to administrators.'
            : `Editing /${item.slug}. Publish to make it available to the public API.`
        }
        status={item.status}
        changed={item.changed}
        hasPublished={item.hasPublished}
        version={item.version}
        updatedAt={item.updatedAt}
        publishedAt={item.publishedAt}
        viewHref={viewHref(item, me?.siteOrigin)}
        canEdit={canEdit}
        canPublish={canPublish}
        canDelete={canDelete && !item.slug.startsWith('_')}
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
            title="Page identity"
            description="The title is used in the admin; the slug is the public address."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Internal title"
              value={internalTitle}
              disabled={!canEdit}
              onChange={(event) => {
                setInternalTitle(event.target.value)
                setDirty(true)
              }}
            />
            <TextInput
              label="Slug"
              value={item.slug}
              disabled
              hint={item.status === 'published' ? 'Slugs cannot change after publishing.' : 'Set when the page is created.'}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeading
            title="Content"
            description="Required fields are marked with an asterisk; they are checked again when you publish."
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
            <p className="text-[13px] text-obsidian/55">This document type has no editor definition.</p>
          )}
        </Panel>
      </EditorFrame>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'delete'
            ? 'Delete this page?'
            : confirm === 'unpublish'
              ? 'Unpublish this page?'
              : 'Discard unpublished changes?'
        }
        description={
          confirm === 'delete'
            ? 'The page and its draft will be removed. Any form sources registered for a service page remain in the Forms screen.'
            : confirm === 'unpublish'
              ? 'The published snapshot stays available for re-publishing, but the public API stops serving it immediately.'
              : 'The draft is replaced by the last published snapshot. This cannot be undone.'
        }
        confirmLabel={
          confirm === 'delete' ? 'Delete page' : confirm === 'unpublish' ? 'Unpublish' : 'Revert draft'
        }
        loading={confirming}
        onConfirm={() => void runConfirmed()}
        onClose={() => setConfirm(null)}
      />
    </>
  )
}

function viewHref(item: DocumentView, siteOrigin: string | undefined): string | undefined {
  if (!siteOrigin) return undefined
  const base = siteOrigin.replace(/\/+$/, '')
  if (item.slug === '_site' || item.slug === '_navigation' || item.slug === '_footer') {
    return undefined
  }
  if (item.slug === '_home') return `${base}/`
  if (item.slug === '_services') return `${base}/services`
  if (item.slug === '_work') return `${base}/work`
  return `${base}/${item.slug}`
}
