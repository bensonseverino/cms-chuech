import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import { api, queryString } from '../api/client'
import type { ProjectView } from '../api/types'
import { slugify } from '@marino/content-schema'
import {
  Badge,
  Button,
  Modal,
  SearchInput,
  TextInput,
} from '../components/ui'
import {
  AlertCircle,
  ArrowRight,
  Copy,
  CheckCircle,
  Edit2,
  ExternalLink,
  Plus,
  Trash2,
} from 'lucide-react'

type Category = { id: string; slug: string; label: string }

export default function Projects() {
  const navigate = useNavigate()
  const { me } = useAuth()
  const { push } = useToast()
  // "View" must open the public site, not this SPA. A react-router <Link> here
  // resolves against the CMS origin and lands on the admin's 404 page.
  const siteOrigin = (me?.siteOrigin ?? '').replace(/\/+$/, '')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [creating, setCreating] = useState(false)

  const path = useMemo(
    () =>
      `/api/admin/projects${queryString({ q: q || undefined, status: status || undefined })}`,
    [q, status],
  )
  const { data, loading, reload } = useApi<{
    items: ProjectView[]
    categories: Category[]
  }>(path)
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    if (data?.categories) { setCategories(data.categories) }
  }, [data])

  const createProject = useCallback(async () => {
    if (!newTitle.trim()) {
      push('Enter a project title')
      return
    }
    setCreating(true)
    try {
      const slug = newSlug.trim() || slugify(newTitle)
      await api.post('/api/admin/projects', { title: newTitle, slug })
      push('Project created')
      setShowNew(false)
      setNewTitle('')
      setNewSlug('')
      reload()
    } catch (e: any) {
      push({ title: e.message, tone: 'error' })
    } finally {
      setCreating(false)
    }
  }, [newTitle, newSlug, push, reload])

  const handleDuplicate = useCallback(
    async (project: ProjectView) => {
      try {
        await api.post(`/api/admin/projects/${project.id}/duplicate`)
        push('Duplicated')
        reload()
      } catch (e: any) {
        push({ title: e.message, tone: 'error' })
      }
    },
    [push, reload],
  )

  const handleDelete = useCallback(
    (project: ProjectView) => {
      if (!window.confirm(`Delete "${project.title}"?`)) return
      api.delete(`/api/admin/projects/${project.id}`)
        .then(() => {
          push('Deleted')
          reload()
        })
        .catch((e: any) => push({ title: e.message, tone: 'error' }))
    },
    [push, reload],
  )

  const handlePublish = useCallback(
    async (project: ProjectView) => {
      try {
        await api.post(`/api/admin/projects/${project.id}/publish`)
        push('Published')
        reload()
      } catch (e: any) {
        push({ title: e.message, tone: 'error' })
      }
    },
    [push, reload],
  )

  const handleUnpublish = useCallback(
    async (project: ProjectView) => {
      try {
        await api.post(`/api/admin/projects/${project.id}/unpublish`)
        push('Unpublished')
        reload()
      } catch (e: any) {
        push({ title: e.message, tone: 'error' })
      }
    },
    [push, reload],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Projects</h2>
          <p className="text-sm text-obsidian/50">Case studies and work projects</p>
        </div>
        <div className="flex gap-2">
          {siteOrigin && (
            <a
              href={`${siteOrigin}/work`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-obsidian/15 bg-white px-3 text-xs font-medium text-obsidian transition-colors hover:bg-fog"
              title="See all published work on the site"
            >
              View all published work
              <ExternalLink size={13} strokeWidth={1.7} aria-hidden="true" />
            </a>
          )}
          <Button variant="outline" onClick={() => setShowNew(true)}>
            <Plus size={16} />
            New project
          </Button>
          <Button size="sm" icon={Edit2} disabled>
            Bulk reorder
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search title, slug, category…"
          className="w-64"
        />
        <select
          className="h-9 rounded-input border border-obsidian/15 bg-white px-3 text-sm"
          value={status ?? ''}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setStatus(e.target.value || null)
          }
        >
          <option value="">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
        </select>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data?.items && data.items.filter((p: any) => p.status === 'published').length > 0 && (
            <Badge tone="mint">
              {data.items.filter((p: any) => p.status === 'published').length} published
            </Badge>
          )}
          {data?.items && data.items.filter((p: any) => p.status === 'draft').length > 0 && (
            <Badge tone="lavender">
              {data.items.filter((p: any) => p.status === 'draft').length} drafts
            </Badge>
          )}
        </div>
      )}

      <div className="rounded-card-lg border border-obsidian/10 bg-white shadow-soft overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-fog/60 border-b border-obsidian/10">
              <th className="text-left text-[13px] font-semibold text-obsidian/60 w-10">
                State
              </th>
              <th className="text-left text-[13px] font-semibold text-obsidian/60">
                Project
              </th>
              <th className="text-left text-[13px] font-semibold text-obsidian/60">
                Slug
              </th>
              <th className="text-left text-[13px] font-semibold text-obsidian/60">
                Categories
              </th>
              <th className="text-left text-[13px] font-semibold text-obsidian/60">
                Featured
              </th>
              <th className="text-right text-[13px] font-semibold text-obsidian/60">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-obsidian/10">
            {loading
              ? [0, 1, 2].map((n) => (
                  <tr key={n} className="animate-pulse">
                    <td className="py-3">
                      <div className="h-4 w-12 bg-fog rounded" />
                    </td>
                    <td className="py-3">
                      <div className="h-4 w-48 bg-fog rounded" />
                    </td>
                    <td className="py-3">
                      <div className="h-4 w-32 bg-fog rounded" />
                    </td>
                    <td className="py-3">
                      <div className="h-4 w-24 bg-fog rounded" />
                    </td>
                    <td className="py-3">
                      <div className="h-4 w-10 bg-fog rounded" />
                    </td>
                    <td className="py-3">
                      <div className="h-6 w-24 bg-fog rounded mx-auto" />
                    </td>
                  </tr>
                ))
              : data?.items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-fog/40">
                    <td className="py-3">
                      <Badge
                        tone={item.status === 'published' ? 'mint' : 'lavender'}
                        dot
                      >
                        {item.status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-obsidian">
                          {item.title || 'Untitled'}
                        </span>
                        {item.clientName && (
                          <span className="text-xs text-obsidian/40 bg-obsidian/5 px-2 py-0.5 rounded-full">
                            {item.clientName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="text-sm text-obsidian/60 font-mono">
                        /{item.slug}
                      </span>
                    </td>
                    <td className="py-3">
                      {item.categories.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.categories.map((c: any) => (
                            <Badge key={c.id} tone="lavender">{c.label}</Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-obsidian/40">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      <input
                        type="checkbox"
                        checked={item.isFeatured}
                        onChange={() => {}}
                        className="h-4 w-4 rounded border-obsidian/30 bg-white"
                      />
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Edit2}
                          onClick={() => navigate(`/projects/${item.id}`)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Copy}
                          onClick={() => handleDuplicate(item)}
                        />
                        {item.status === 'draft' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={CheckCircle}
                            onClick={() => handlePublish(item)}
                          >
                            Publish
                          </Button>
                        )}
                        {item.status === 'published' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={AlertCircle}
                            onClick={() => handleUnpublish(item)}
                          >
                            Unpublish
                          </Button>
                        )}
                        {item.status === 'published' && siteOrigin && (
                          <>
                            {/* "View" opens the published work listing so the
                                owner sees ALL published work, not just the one
                                row they clicked. */}
                            <a
                              href={`${siteOrigin}/work`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center h-9 rounded-full border border-obsidian/15 bg-white px-3 text-xs font-medium text-obsidian hover:bg-fog"
                              title="See all published work on the site"
                            >
                              View
                              <ArrowRight size={12} className="-ml-1" />
                            </a>
                            <a
                              href={`${siteOrigin}/work/${encodeURIComponent(item.slug)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex h-9 w-9 items-center justify-center rounded-full text-obsidian/45 transition-colors hover:bg-fog hover:text-obsidian"
                              title={`Open the ${item.title || item.slug} case study`}
                              aria-label={`Open the ${item.title || item.slug} case study`}
                            >
                              <ExternalLink size={14} strokeWidth={1.7} />
                            </a>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          onClick={() => handleDelete(item)}
                          className="text-obsidian/50"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="py-12 text-center text-sm text-obsidian/40"
                >
                  No projects found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="New project"
        description="Start from a blank project. You can change the title and slug later."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button onClick={createProject} loading={creating}>
              Create project
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 max-w-sm">
          <TextInput
            label="Title"
            value={newTitle}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setNewTitle(e.target.value)
            }
            placeholder="My project"
            required
          />
          <TextInput
            label="Slug"
            value={newSlug}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setNewSlug(e.target.value)
            }
            placeholder="my-project"
            hint="Auto-generated from title if left blank"
          />
        </div>
      </Modal>
    </div>
  )
}
