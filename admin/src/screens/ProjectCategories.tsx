import { useCallback, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useToast } from '../providers/ToastProvider'
import { api } from '../api/client'
import {
  Badge,
  Button,
  ConfirmDialog,
  Modal,
  TextInput,
} from '../components/ui'
import { Edit, Trash2 } from 'lucide-react'

type Category = {
  id: string
  slug: string
  label: string
  position: number
  projectCount: number
}

export default function ProjectCategories() {
  const { data: categories = [], reload } = useApi<Category[]>(
    '/api/admin/project-categories',
  )
  const { push } = useToast()

  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState<{ label: string; slug: string }>({ label: '', slug: '' })
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null)

  const sorted = [...(categories ?? [])].sort((a, b) => a.position - b.position)

  const handleSave = useCallback(async () => {
    if (!form.label?.trim()) {
      push('Enter a label')
      return
    }
    setSubmitting(true)
    try {
      const payload = { label: form.label.trim(), slug: form.slug.trim() }
      if (editing) {
        await api.put(`/api/admin/project-categories/${editing.id}`, payload)
        push('Category updated')
      } else {
        await api.post('/api/admin/project-categories', payload)
        push('Category created')
      }
      setEditing(null)
      setForm({ label: '', slug: '' })
      reload()
    } catch (e: any) {
      push({ title: e.message || 'Could not save category', tone: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [editing, form, push, reload])

  const handleDelete = useCallback((category: Category) => {
    setConfirmDelete(category)
  }, [])

  const confirmDeleteAction = useCallback(async () => {
    const category = confirmDelete
    if (!category) return
    try {
      await api.delete(`/api/admin/project-categories/${category.id}`)
      push('Category deleted')
      reload()
    } catch (e: any) {
      push({ title: e.message || 'Could not delete', tone: 'error' })
    } finally {
      setConfirmDelete(null)
    }
  }, [confirmDelete, push, reload])

  const handleEdit = useCallback((category: Category) => {
    setEditing(category)
    setForm({ label: category.label, slug: category.slug })
  }, [])

  const isModalOpen = !!editing || form.label !== ''

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-2">
        {sorted.length === 0 && (
          <li className="text-sm text-obsidian/50 py-6 text-center">
            No categories yet. Create one to get started.
          </li>
        )}
        {sorted.map((category) => (
          <li
            key={category.id}
            className="flex items-center gap-3 rounded-lg border border-obsidian/10 bg-fog/60 p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{category.label}</span>
                {category.projectCount > 0 && (
                  <Badge tone="neutral">
                    {category.projectCount} project
                    {category.projectCount === 1 ? '' : 's'}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-obsidian/40">/{category.slug}</span>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                icon={Edit}
                onClick={() => handleEdit(category)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                onClick={() => handleDelete(category)}
              />
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={isModalOpen}
        onClose={() => {
          setEditing(null)
          setForm({ label: '', slug: '' })
        }}
        title={editing ? 'Edit category' : 'New category'}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null)
                setForm({ label: '', slug: '' })
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} loading={submitting}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </>
        }
      >          <div className="flex flex-col gap-4">
          <TextInput
            label="Label"
            value={form.label ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, label: e.target.value }))
            }
            placeholder="Branding"
          />
          <TextInput
            label="Slug"
            value={form.slug ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, slug: e.target.value }))
            }
            placeholder="branding"
            hint="Lowercase letters, numbers and hyphens"
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete category?"
        description={
          confirmDelete
            ? `This will delete "${confirmDelete.label}" and remove it from all projects.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDeleteAction}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  )
}
