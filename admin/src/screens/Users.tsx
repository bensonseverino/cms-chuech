import { useEffect, useState } from 'react'
import { ShieldAlert, UserPlus } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import type { Role, UserView } from '../api/types'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
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
  Select,
  TextInput,
  Toggle,
} from '../components/ui'
import { formatDateTime, initials } from '../lib/format'

/*
 * Users map Access-authenticated emails to CMS roles. Access remains the gate:
 * inviting someone here does not create an Access policy, and a role row for an
 * email that Access rejects can never sign in.
 */

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin — full access' },
  { value: 'editor', label: 'Editor — content and inbox' },
  { value: 'viewer', label: 'Viewer — read only' },
]

export default function Users() {
  const { me, reload: reloadMe } = useAuth()
  const { push } = useToast()
  const { data, error, loading, reload } = useApi<{ items: UserView[] }>(
    me?.user.role === 'admin' ? '/users' : null,
  )
  const [editing, setEditing] = useState<UserView | 'new' | null>(null)
  const [deactivating, setDeactivating] = useState<UserView | null>(null)
  const [busy, setBusy] = useState(false)

  const items = data?.items ?? []
  const canManage = me?.user.role === 'admin'

  async function deactivate() {
    if (!deactivating) return
    setBusy(true)
    try {
      await api.delete(`/users/${encodeURIComponent(deactivating.id)}`)
      push({ title: 'User deactivated', description: deactivating.email })
      setDeactivating(null)
      reload()
      reloadMe()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not deactivate the user', description: errorMessage(cause) })
      setDeactivating(null)
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) {
    return (
      <Panel>
        <EmptyState
          icon={ShieldAlert}
          title="Admin only"
          description="Your role can use the CMS but cannot change users."
        />
      </Panel>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Users"
        description="Roles are checked on every API request. Cloudflare Access decides who reaches the CMS; this table decides what they can do once inside."
        actions={
          <Button icon={UserPlus} onClick={() => setEditing('new')}>
            Invite user
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-panel border border-obsidian/10 bg-secondary/25 px-5 py-4">
        <ShieldAlert size={18} strokeWidth={1.6} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p className="text-[12px] leading-5 text-obsidian/65">
          <strong className="font-semibold">Access is separate.</strong> Add the same email to the
          Cloudflare Access policy for{' '}
          <span className="font-mono text-[11px]">{window.location.origin}</span> before they can use
          the CMS. An inactive user keeps their history but cannot sign in through this API.
        </p>
      </div>

      {loading && !data ? (
        <Panel>
          <LoadingRows rows={5} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState icon={UserPlus} title="No CMS users" description="Invite the first person after they are allowed through Access." />
        </Panel>
      ) : (
        <Panel className="p-[10px] lg:p-[10px]">
          <div className="hidden items-center gap-3 border-b border-obsidian/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40 md:flex">
            <span className="w-9" />
            <span className="flex-1">User</span>
            <span className="w-28">Role</span>
            <span className="w-24">State</span>
            <span className="w-40">Last login</span>
            <span className="w-20" />
          </div>
          <ul className="flex flex-col">
            {items.map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-center gap-3 rounded-card-lg border-b border-obsidian/10 px-3 py-3 last:border-b-0 hover:bg-fog/50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fog text-[11px] font-bold text-obsidian/60">
                  {initials(user.name || user.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold">{user.name || user.email}</span>
                    {user.id === me?.user.id && <Badge tone="mint">You</Badge>}
                  </span>
                  <span className="block truncate text-[11px] text-obsidian/45">{user.email}</span>
                </span>
                <span className="w-28 shrink-0">
                  <Badge tone={roleTone(user.role)}>{user.role}</Badge>
                </span>
                <span className="w-24 shrink-0">
                  <Badge tone={user.active ? 'mint' : 'neutral'} dot>
                    {user.active ? 'Active' : 'Inactive'}
                  </Badge>
                </span>
                <span className="hidden w-40 text-[11px] text-obsidian/45 md:block">
                  {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                </span>
                <span className="w-20 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(user)}>
                    Edit
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <UserDialog
        open={editing !== null}
        user={editing === 'new' ? null : editing}
        currentUserId={me?.user.id ?? ''}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
          reloadMe()
        }}
        onDeactivate={(user) => {
          setEditing(null)
          setDeactivating(user)
        }}
      />

      <ConfirmDialog
        open={deactivating !== null}
        title="Deactivate this user?"
        description="They will be signed out of the CMS API immediately. Their history stays in the audit log, and an admin can reactivate them later."
        confirmLabel="Deactivate"
        loading={busy}
        onConfirm={() => void deactivate()}
        onClose={() => setDeactivating(null)}
      />
    </>
  )
}

function UserDialog({
  open,
  user,
  currentUserId,
  onClose,
  onSaved,
  onDeactivate,
}: {
  open: boolean
  user: UserView | null
  currentUserId: string
  onClose: () => void
  onSaved: () => void
  onDeactivate: (user: UserView) => void
}) {
  const { push } = useToast()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setEmail(user?.email ?? '')
    setName(user?.name ?? '')
    setRole(user?.role ?? 'editor')
    setActive(user?.active ?? true)
    setError(null)
  }, [open, user])

  const isSelf = Boolean(user && user.id === currentUserId)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (user) {
        await api.patch(`/users/${encodeURIComponent(user.id)}`, {
          name: name.trim() || null,
          role,
          active,
        })
        push({ title: 'User updated', description: user.email })
      } else {
        await api.post('/users', {
          email: email.trim(),
          name: name.trim() || null,
          role,
        })
        push({ title: 'User invited', description: email.trim() })
      }
      onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Edit user' : 'Invite user'}
      description={
        user
          ? 'Changes apply on their next API request.'
          : 'The email must already be allowed by Cloudflare Access.'
      }
      size="sm"
      footer={
        <>
          {user && !isSelf && user.active && (
            <Button variant="ghost" onClick={() => onDeactivate(user)} disabled={saving}>
              Deactivate
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {user ? 'Save changes' : 'Send invite'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextInput
          label="Email"
          type="email"
          value={email}
          disabled={Boolean(user)}
          onChange={(event) => setEmail(event.target.value)}
          hint={user ? 'The email is the Access identity and cannot change here.' : undefined}
          required
        />
        <TextInput
          label="Name"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          hint="Optional display name."
        />
        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={role}
          disabled={isSelf}
          onChange={(event) => setRole(event.target.value as Role)}
          hint={
            isSelf
              ? 'You cannot remove your own admin access.'
              : role === 'admin'
                ? 'Admins can manage users, forms and deletions.'
                : role === 'editor'
                  ? 'Editors can edit, publish, upload and work the inbox.'
                  : 'Viewers can read content and the inbox but cannot change anything.'
          }
        />
        {user && (
          <Toggle
            checked={active}
            onChange={setActive}
            disabled={isSelf}
            label="Active"
            description={
              isSelf
                ? 'You cannot deactivate your own account.'
                : 'Inactive users are signed out and rejected by the admin API.'
            }
          />
        )}
        {user && (
          <p className="text-[11px] text-obsidian/40">
            Added {formatDateTime(user.createdAt)}
            {user.lastLoginAt ? ` · Last login ${formatDateTime(user.lastLoginAt)}` : ''}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-card-lg border border-obsidian/20 p-3 text-[12px] font-medium">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

function roleTone(role: Role): 'dark' | 'lavender' | 'neutral' {
  if (role === 'admin') return 'dark'
  if (role === 'editor') return 'lavender'
  return 'neutral'
}
