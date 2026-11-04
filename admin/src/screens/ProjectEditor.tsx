import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useApi } from '../hooks/useApi'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import { api, queryString } from '../api/client'
import { AlertCircle, Copy, ExternalLink, Lock, Save, Trash2 } from 'lucide-react'
import {
  Button,
  ConfirmDialog,
  ErrorState,
  FieldErrors,
  LoadingRows,
  PageHeader,
  Panel,
  PanelHeading,
  Select,
  Tabs,
  Textarea,
  TextInput,
} from '../components/ui'
import { ImageRefField } from './ImageRefField'
import { IntroEditorField } from './IntroEditor-field'
import { CustomPreviewPanel } from '../components/CustomPreviewPanel'
import type { MediaView, ProjectView } from '../api/types'
import { slugify } from '@marino/content-schema'

/* Project editor (cms-projects-spec.md §4, §7).

Eight sections: Basics, Hero, Intro, Feature, Gallery, Testimonial,
Similar Work, SEO. Save writes the draft; publish validates the checklist;
slug renames insert into project_slug_history.
*/

type Section = 'basics' | 'hero' | 'intro' | 'feature' | 'gallery' | 'testimonial' | 'related' | 'seo'

type Form = {
  title: string
  slug: string
  clientName: string
  categories: string[]
  isFeatured: boolean
  heroType: 'image' | 'video'
  heroImage: { mediaId: string; alt?: string; focalX?: number; focalY?: number } | null
  heroImageMobile: { mediaId: string; alt?: string; focalX?: number; focalY?: number } | null
  heroVideoUrl: string
  heroLead: string
  heroBody: string
  introHtml: string
  featureHeading: string
  featureText: string
  gallery: { mediaId: string; alt?: string; focalX?: number; focalY?: number }[]
  testimonialQuote: string
  testimonialAuthor: string
  testimonialCompany: string
  relatedMode: 'auto' | 'manual'
  relatedIds: string[]
  seoTitle: string
  seoDescription: string
}

const emptyForm: Form = {
  title: '',
  slug: '',
  clientName: '',
  categories: [],
  isFeatured: false,
  heroType: 'image',
  heroImage: null,
  heroImageMobile: null,
  heroVideoUrl: '',
  heroLead: '',
  heroBody: '',
  introHtml: '',
  featureHeading: '',
  featureText: '',
  gallery: [],
  testimonialQuote: '',
  testimonialAuthor: '',
  testimonialCompany: '',
  relatedMode: 'auto',
  relatedIds: [],
  seoTitle: '',
  seoDescription: '',
}

function formFromView(view: ProjectView): Form {
  return {
    title: view.title ?? '',
    slug: view.slug ?? '',
    clientName: view.clientName ?? '',
    categories: (view.categories ?? []).map((c: { slug: string }) => c.slug),
    isFeatured: view.isFeatured ?? false,
    heroType: view.heroType ?? 'image',
    heroImage: view.heroImage ?? null,
    heroImageMobile: view.heroImageMobile ?? null,
    heroVideoUrl: view.heroVideoUrl ?? '',
    heroLead: view.heroLead ?? '',
    heroBody: view.heroBody ?? '',
    introHtml: view.introHtml ?? '',
    featureHeading: view.featureHeading ?? '',
    featureText: view.featureText ?? '',
    gallery: view.gallery ?? [],
    testimonialQuote: view.testimonialQuote ?? '',
    testimonialAuthor: view.testimonialAuthor ?? '',
    testimonialCompany: view.testimonialCompany ?? '',
    relatedMode: view.relatedMode ?? 'auto',
    relatedIds: view.relatedIds ?? [],
    seoTitle: view.seoTitle ?? '',
    seoDescription: view.seoDescription ?? '',
  }
}

type EditorData = {
  item: ProjectView
  media: Record<string, MediaView>
  categories: { id: string; slug: string; label: string }[]
}

export default function ProjectEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const isValidId = id && id !== 'new'

  const { me } = useAuth()
  const { push } = useToast()

  const { data, error: fetchError, loading, reload } = useApi<EditorData>(
    isValidId ? `/api/admin/projects/${id}` : null,
  )

  const { data: publishedData } = useApi<{ items: ProjectView[] }>(
    `/api/admin/projects${queryString({ status: 'published', limit: 50 })}`,
  )

  const [form, setForm] = useState<Form>(emptyForm)
  const [media, setMedia] = useState<Record<string, MediaView>>({})
  const [categories, setCategories] = useState<{ id: string; slug: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [actionError, setActionError] = useState<Error | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ path: string; message: string }[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activeSection, setActiveSection] = useState<Section>('basics')
  const [previewActive, setPreviewActive] = useState(false)
  const [previewProject, setPreviewProject] = useState<Record<string, unknown> | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const formRef = useRef(form)
  formRef.current = form

  useUnsavedChanges(dirty, 'You have unsaved changes. Leave without saving?')

  useEffect(() => {
    if (data) {
      setForm(formFromView(data.item))
      setMedia(data.media ?? {})
      setCategories(data.categories ?? [])
      setActionError(null)
      setFieldErrors([])
    }
  }, [data])

  useEffect(() => {
    if (data?.categories) setCategories(data.categories)
  }, [data?.categories])

  const update = useCallback(
    <K extends keyof Form>(key: K, value: Form[K]) => {
      setForm((f) => ({ ...f, [key]: value }))
      setDirty(true)
      setActionError(null)
      setFieldErrors([])
    },
    [],
  )

  const addGalleryItem = useCallback(
    (item: Form['gallery'][number]) => {
      setForm((f) => ({ ...f, gallery: [...f.gallery, item] }))
      setDirty(true)
    },
    [],
  )

  const removeGalleryItem = useCallback(
    (index: number) => {
      setForm((f) => ({
        ...f,
        gallery: f.gallery.filter((_, i) => i !== index),
      }))
      setDirty(true)
    },
    [],
  )

  const moveGalleryItem = useCallback(
    (from: number, to: number) => {
      setForm((f) => {
        const next = [...f.gallery]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        return { ...f, gallery: next }
      })
      setDirty(true)
    },
    [],
  )

  const save = useCallback(async () => {
    if (!isValidId) return
    setSaving(true)
    setActionError(null)
    setFieldErrors([])
    try {
      const payload = {
        ...formRef.current,
      }
      const response = await api.put(`/api/admin/projects/${id}`, payload)
      setMedia((response as any).media ?? media)
      setDirty(false)
      push('Draft saved')
    } catch (cause: any) {
      setActionError(new Error(cause?.message ?? 'Could not save'))
      setFieldErrors(cause?.fields ?? [])
    } finally {
      setSaving(false)
    }
  }, [id, isValidId, media, push])

  const publish = useCallback(async () => {
    if (!isValidId) return
    setPublishing(true)
    setActionError(null)
    setFieldErrors([])
    try {
      if (dirty) {
        const payload = { ...formRef.current }
        await api.put(`/api/admin/projects/${id}`, payload)
        setDirty(false)
      }
      await api.post(`/api/admin/projects/${id}/publish`)
      push({ title: 'Published', description: `/${formRef.current.slug}` })
      setPreviewActive(false)
      setPreviewProject(null)
      reload()
    } catch (cause: any) {
      setActionError(new Error(cause?.message ?? 'Could not publish'))
      setFieldErrors(cause?.fields ?? [])
    } finally {
      setPublishing(false)
    }
  }, [id, isValidId, dirty, push, reload, formRef])

  const unpublish = useCallback(async () => {
    if (!isValidId) return
    try {
      await api.post(`/api/admin/projects/${id}/unpublish`)
      push('Unpublished')
      reload()
    } catch (cause: any) {
      setActionError(new Error(cause?.message ?? 'Could not unpublish'))
    }
  }, [id, isValidId, push, reload])

  const duplicate = useCallback(async () => {
    if (!isValidId) return
    try {
      const resp = await api.post(`/api/admin/projects/${id}/duplicate`)
      push('Duplicated')
      const newId = (resp as any)?.id ?? (resp as any)?.item?.id
      if (newId) navigate(`/projects/${newId}`, { replace: true })
      else reload()
    } catch (cause: any) {
      push({ title: cause?.message ?? 'Could not duplicate', tone: 'error' })
    }
  }, [id, isValidId, push, navigate, reload])

  const remove = useCallback(async () => {
    if (!isValidId) return
    setDeleting(true)
    try {
      await api.delete(`/api/admin/projects/${id}`)
      push('Deleted')
      navigate('/projects', { replace: true })
    } catch (cause: any) {
      push({ title: cause?.message ?? 'Could not delete', tone: 'error' })
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }, [id, isValidId, push, navigate])

  const slugChanged = useCallback((value: string) => {
    const trimmed = value.trim()
    const cleaned = slugify(trimmed)
    const candidate =
      trimmed && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) ? trimmed : cleaned
    update('slug', candidate)
  }, [update])

  const activatePreview = useCallback(async () => {
    if (!isValidId || !form.slug) return
    setPreviewLoading(true)
    try {
      const tokenResp = await api.post<{ token: string; url: string; expiresAt: number }>(
        '/api/admin/preview-token',
        { slug: form.slug },
      )
      const draftResp = await fetch(tokenResp.url)
      if (!draftResp.ok) throw new Error('Preview fetch failed')
      const draft = await draftResp.json()
      setPreviewProject(draft.data ?? draft ?? null)
      setPreviewActive(true)
      push('Preview opened')
    } catch (cause: any) {
      push({ title: cause?.message ?? 'Could not open preview', tone: 'error' })
    } finally {
      setPreviewLoading(false)
    }
  }, [form.slug, isValidId, push])

  const canPublish = me?.capabilities.publish ?? false
  const canDelete = me?.capabilities.deleteContent ?? false
  const status = data?.item.status ?? 'draft'
  const hasPublished = status === 'published'
  const siteOrigin = me?.siteOrigin

  if (isNew) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader backTo="/projects" backLabel="Projects" eyebrow="Projects" title="New project" />
        <Panel>
          <PanelHeading
            title="Create a project"
            description="Start from scratch. You can change the title and slug later."
          />
          <div className="flex flex-col gap-4">
            <TextInput
              label="Title"
              value={form.title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('title', e.target.value)}
              placeholder="My project"
            />
            <TextInput
              label="Slug"
              value={form.slug}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => slugChanged(e.target.value)}
              placeholder="my-project"
              hint="Lowercase letters, numbers and hyphens"
            />
            <div className="flex gap-2">
              <Button onClick={save} loading={saving}>Create and edit</Button>
              <Button variant="outline" onClick={() => navigate('/projects', { replace: true })}>
                Cancel
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  if (loading && !data) {
    return <div className="mx-auto max-w-3xl"><LoadingRows /></div>
  }

  if ((fetchError && !data) || (!data && !loading)) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          error={fetchError ?? new Error('This project does not exist or you do not have access.')}
          onRetry={reload}
        />
      </div>
    )
  }

  const view = data!.item
  const mediaMap = data!.media ?? {}

  const heroAsset = useMemo(() => {
    const ref = view.heroImage
    if (!ref) return null
    return mediaMap[ref.mediaId] ?? null
  }, [view.heroImage, mediaMap])

  const publishedItems = publishedData?.items ?? []

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/projects"
        backLabel="Projects"
        eyebrow="Projects"
        title={view.title ?? 'Untitled project'}
        description={view.slug ? `Editing /work/${view.slug}.` : 'This project has no slug; set one in Basics.'}
        actions={
          <>
            {hasPublished && siteOrigin && (
              <a
                href={`${siteOrigin.replace(/\/+$/, '')}/work/${view.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-button border border-obsidian/15 bg-white px-5 text-sm font-medium text-obsidian transition-colors hover:bg-fog"
              >
                <ExternalLink size={15} strokeWidth={1.7} aria-hidden="true" />
                View
              </a>
            )}
            <Button
              variant="ghost"
              onClick={() => (previewActive ? setPreviewActive(false) : activatePreview())}
              disabled={!siteOrigin || !view.slug || previewLoading}
              title="Preview"
            >
              {previewActive ? 'Hide preview' : 'Preview'}
            </Button>
            {canDelete && !isNew && (
              <Button variant="ghost" icon={Copy} onClick={duplicate} disabled={saving || publishing}>
                Duplicate
              </Button>
            )}
            {canPublish && hasPublished ? (
              <Button
                variant="outline"
                icon={Lock}
                onClick={unpublish}
                disabled={saving || publishing}
              >
                Unpublish
              </Button>
            ) : canPublish ? (
              <Button variant="primary" icon={Save} onClick={publish} loading={publishing} disabled={saving}>
                Publish
              </Button>
            ) : null}
            <Button variant="outline" icon={Save} onClick={save} loading={saving} disabled={saving || publishing}>
              Save draft
            </Button>
            {canDelete && !isNew && (
              <Button
                variant="ghost"
                icon={Trash2}
                onClick={() => setConfirmDelete(true)}
                disabled={saving || publishing}
              >
                Delete
              </Button>
            )}
          </>
        }
      />

      {actionError && (
        <div className="mb-4 flex items-start gap-3 rounded-panel border border-obsidian/10 bg-obsidian/5 p-4 text-obsidian">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-obsidian" />
          <div className="min-w-0">
            <p className="font-semibold text-obsidian">Could not save</p>
            <p className="mt-1 text-[13px] leading-5 text-obsidian/70">{actionError.message}</p>
          </div>
        </div>
      )}

      {fieldErrors.length > 0 && <FieldErrors errors={fieldErrors} />}

      {previewActive && siteOrigin && (
        <div className="mb-6">
          <CustomPreviewPanel
            siteOrigin={siteOrigin}
            slug={view.slug}
            projectData={previewProject}
            isActive={previewActive}
            onError={(msg) => push({ title: msg, tone: 'error' })}
          />
        </div>
      )}

      <Tabs
        value={activeSection}
        onChange={(v) => setActiveSection(v as Section)}
        items={[
          { value: 'basics', label: 'Basics' },
          { value: 'hero', label: 'Hero' },
          { value: 'intro', label: 'Intro' },
          { value: 'feature', label: 'Feature' },
          { value: 'gallery', label: 'Gallery' },
          { value: 'testimonial', label: 'Testimonial' },
          { value: 'related', label: 'Similar work' },
          { value: 'seo', label: 'SEO' },
        ]}
      />

      <Panel>
        <PanelHeading title={activeSection} />
        <div className="flex flex-col gap-6">
          {activeSection === 'basics' && (
            <div className="flex flex-col gap-4">
              <TextInput
                label="Title"
                value={form.title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('title', e.target.value)}
                placeholder="Eventotron — real-time event dashboards"
                maxLength={120}
              />
              <TextInput
                label="Slug"
                value={form.slug}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => slugChanged(e.target.value)}
                placeholder="eventotron"
                hint="Lowercase letters, numbers and hyphens. Unique across projects."
              />
              <Textarea
                label="Client"
                value={form.clientName}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update('clientName', e.target.value)}
                placeholder="Acme Corp"
                maxLength={120}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-obsidian">Categories</label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => {
                    const selected = form.categories.includes(cat.slug)
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          const next = selected
                            ? form.categories.filter((s) => s !== cat.slug)
                            : [...form.categories, cat.slug]
                          update('categories', next)
                        }}
                        className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-[11px] font-semibold transition-colors ${
                          selected
                            ? 'bg-primary/40 text-obsidian'
                            : 'bg-lavender/30 text-obsidian hover:bg-lavender/40'
                        }`}
                      >
                        {cat.label}
                      </button>
                    )
                  })}
                </div>
                {form.categories.length === 0 && (
                  <p className="text-[13px] text-obsidian/50">
                    No categories yet. Create one in Project categories.
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-obsidian">
                <input
                  type="checkbox"
                  checked={form.isFeatured}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('isFeatured', e.target.checked)}
                  className="h-4 w-4 rounded border-obsidian/30 bg-white"
                />
                Featured
              </label>
            </div>
          )}

          {activeSection === 'hero' && (
            <div className="flex flex-col gap-4">
              <Select
                label="Hero type"
                value={form.heroType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  update('heroType', e.target.value as 'image' | 'video')
                }
                options={[
                  { value: 'image', label: 'Image' },
                  { value: 'video', label: 'Video' },
                ]}
              />
              {form.heroType === 'image' ? (
                <div className="flex flex-col gap-4">
                  <ImageRefField
                    label="Hero image"
                    value={form.heroImage}
                    onChange={(v) => update('heroImage', v)}
                    media={mediaMap}
                    onMedia={(m) => update('heroImage', { mediaId: m.id, alt: m.alt, focalX: 50, focalY: 50 })}
                  />
                  <ImageRefField
                    label="Mobile hero (below 768px)"
                    value={form.heroImageMobile}
                    onChange={(v) => update('heroImageMobile', v)}
                    media={mediaMap}
                    onMedia={(m) => update('heroImageMobile', { mediaId: m.id, alt: m.alt, focalX: 50, focalY: 50 })}
                  />
                  <Textarea
                    label="Hero lead"
                    value={form.heroLead}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      update('heroLead', e.target.value)
                    }
                    placeholder="A one-line hook that sits above the hero body."
                    maxLength={200}
                  />
                  <Textarea
                    label="Hero body"
                    value={form.heroBody}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      update('heroBody', e.target.value)
                    }
                    placeholder="The hero section body copy."
                    maxLength={600}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <TextInput
                    label="Video URL"
                    value={form.heroVideoUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      update('heroVideoUrl', e.target.value)
                    }
                    placeholder="https://ik.imagekit.io/..."
                    hint="Must be an https:// URL from an allowed host."
                  />
                  <Textarea
                    label="Hero lead"
                    value={form.heroLead}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      update('heroLead', e.target.value)
                    }
                    placeholder="A one-line hook."
                    maxLength={200}
                  />
                </div>
              )}
              {heroAsset && (
                <div className="rounded-panel border border-obsidian/10 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-obsidian/50 mb-2">
                    Hero preview
                  </p>
                  <img
                    src={heroAsset.url}
                    alt={heroAsset.alt ?? ''}
                    className="h-24 w-32 rounded object-cover bg-obsidian/5"
                  />
                  <div className="mt-2 flex items-center gap-3 text-[12px] text-obsidian/50">
                    <span>{heroAsset.width}×{heroAsset.height}</span>
                    {heroAsset.variants.length > 1 && (
                      <span>{heroAsset.variants.map((v) => `${v.w}w`).join(', ')}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === 'intro' && (
            <div className="flex flex-col gap-4">
              <IntroEditorField
                label="Intro statement"
                content={form.introHtml}
                onChange={(html) => update('introHtml', html)}
              />
              <p className="text-[13px] text-obsidian/50">
                Rich text with bold, italic, links and highlights. Max 1200 characters.
              </p>
            </div>
          )}

          {activeSection === 'feature' && (
            <div className="flex flex-col gap-4">
              <Textarea
                label="Feature heading"
                value={form.featureHeading}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  update('featureHeading', e.target.value)
                }
                placeholder="Why this mattered"
                maxLength={80}
              />
              <Textarea
                label="Feature text"
                value={form.featureText}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  update('featureText', e.target.value)
                }
                placeholder="The case for the work."
                maxLength={800}
              />
            </div>
          )}

          {activeSection === 'gallery' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-obsidian">Images</p>
                <span className="text-[13px] text-obsidian/50">{form.gallery.length}/24</span>
              </div>
              {form.gallery.length === 0 ? (
                <p className="text-[13px] text-obsidian/50 py-4 text-center">No images yet. Add one below.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {form.gallery.map((item, index) => {
                    const m = mediaMap[item.mediaId]
                    return (
                      <li
                        key={index}
                        className="flex items-start gap-4 rounded-panel border border-obsidian/10 bg-white p-3"
                      >
                        <img
                          src={m?.url ?? ''}
                          alt={item.alt ?? ''}
                          className="h-16 w-20 shrink-0 rounded object-cover bg-obsidian/5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-obsidian truncate">
                            {item.alt ?? m?.filename ?? 'Image'}
                          </p>
                          <p className="text-[12px] text-obsidian/40">
                            {m?.width}×{m?.height}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => removeGalleryItem(index)}>
                            Remove
                          </Button>
                          {index > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => moveGalleryItem(index, index - 1)}
                            >
                              ↑
                            </Button>
                          )}
                          {index < form.gallery.length - 1 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => moveGalleryItem(index, index + 1)}
                            >
                              ↓
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <ImageRefField
                label="Add image"
                value={null}
                onChange={(v) => v && addGalleryItem(v)}
                media={mediaMap}
                onMedia={(m) => addGalleryItem({ mediaId: m.id, alt: m.alt, focalX: 50, focalY: 50 })}
              />
            </div>
          )}

          {activeSection === 'testimonial' && (
            <div className="flex flex-col gap-4">
              <Textarea
                label="Quote"
                value={form.testimonialQuote}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  update('testimonialQuote', e.target.value)
                }
                placeholder="This team changed how we think about our brand."
                maxLength={800}
              />
              <TextInput
                label="Author"
                value={form.testimonialAuthor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  update('testimonialAuthor', e.target.value)
                }
                placeholder="Jane Doe"
              />
              <TextInput
                label="Company"
                value={form.testimonialCompany}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  update('testimonialCompany', e.target.value)
                }
                placeholder="Acme Corp"
              />
            </div>
          )}

          {activeSection === 'related' && (
            <div className="flex flex-col gap-4">
              <Select
                label="Similar work"
                value={form.relatedMode}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  update('relatedMode', e.target.value as 'auto' | 'manual')
                }
                options={[
                  { value: 'auto', label: 'Automatic (same categories)' },
                  { value: 'manual', label: 'Manual selection' },
                ]}
              />
              {form.relatedMode === 'manual' && (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] text-obsidian/50">
                    Choose up to 12 published projects.
                  </p>
                  {publishedItems
                    .filter((p) => form.relatedIds.includes(p.id))
                    .map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-4 rounded-panel border border-obsidian/10 bg-white p-3"
                      >
                        <span className="text-sm font-medium text-obsidian">
                          {p.title ?? 'Untitled'}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            update(
                              'relatedIds',
                              form.relatedIds.filter((id) => id !== p.id),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  {publishedItems
                    .filter((p) => !form.relatedIds.includes(p.id))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          update('relatedIds', [...form.relatedIds, p.id])
                        }
                        className="flex w-full items-center gap-3 rounded-panel border border-obsidian/10 bg-white p-3 text-left transition-colors hover:bg-fog"
                      >
                        <span className="text-sm text-obsidian truncate flex-1">
                          {p.title ?? 'Untitled'}
                        </span>
                        <span className="text-[11px] text-obsidian/40">+ Add</span>
                      </button>
                    ))}
                  {form.relatedIds.length >= 12 && (
                    <p className="text-[13px] text-obsidian/50">Maximum 12 projects.</p>
                  )}
                </div>
              )}
              {form.relatedMode === 'auto' && form.categories.length > 0 && (
                <p className="text-[13px] text-obsidian/50">
                  Projects in{' '}
                  {form.categories
                    .map(
                      (s) =>
                        categories.find((c) => c.slug === s)?.label ?? s,
                    )
                    .join(', ')}
                  {''}
                  will appear automatically.
                </p>
              )}
            </div>
          )}

          {activeSection === 'seo' && (
            <div className="flex flex-col gap-4">
              <TextInput
                label="SEO title"
                value={form.seoTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  update('seoTitle', e.target.value)
                }
                placeholder={form.title || 'Eventotron — real-time event dashboards'}
                maxLength={120}
              />
              <Textarea
                label="SEO description"
                value={form.seoDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  update('seoDescription', e.target.value)
                }
                placeholder="A short meta description for search engines."
                maxLength={320}
              />
            </div>
          )}
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this project?"
        description={
          `This permanently deletes "${view.title ?? 'Untitled'}" and all of its images. This cannot be undone.`
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
