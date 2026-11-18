import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowUpRight,
  BellRing,
  BriefcaseBusiness,
  FileText,
  FormInput,
  Home,
  Image as ImageIcon,
  Menu,
  PanelBottom,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react'
import type { DocumentListResponse, NotificationsSettings } from '../api/types'
import { api, errorMessage } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../providers/AuthProvider'
import { useToast } from '../providers/ToastProvider'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Panel,
  PanelHeading,
  StatusBadge,
  Textarea,
  Toggle,
  buttonClass,
} from '../components/ui'

/*
 * Settings hub. Site identity, navigation and footer are documents with their
 * own schema, so they open in the same editor as every other document instead
 * of being duplicated into a second set of forms here.
 */

export default function Settings() {
  const { me } = useAuth()
  const { data, error, loading, reload } = useApi<DocumentListResponse>('/documents')
  const items = data?.items ?? []
  const site = items.find((item) => item.slug === '_site')
  const navigation = items.find((item) => item.slug === '_navigation')
  const footer = items.find((item) => item.slug === '_footer')
  const home = items.find((item) => item.slug === '_home')

  const siteData = site?.data ?? {}
  const companyName = stringField(siteData, 'companyName')
  const email = stringField(siteData, 'email')
  const phone = stringField(siteData, 'phone')

  if (!me?.capabilities.manageSettings) {
    return (
      <Panel>
        <EmptyState
          icon={ShieldAlert}
          title="Admin only"
          description="Site identity, navigation, footer and the environment summary are restricted to administrators."
        />
      </Panel>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Workspace"
        description="Site identity, navigation, footer and the tools that keep the CMS running. Every change is audited."
        actions={
          me?.capabilities.manageUsers ? (
            <Link to="/users" className={buttonClass('outline', 'md')}>
              <Users size={15} strokeWidth={1.7} aria-hidden="true" />
              Manage users
            </Link>
          ) : undefined
        }
      />

      {loading && !data ? (
        <Panel>
          <LoadingRows rows={6} />
        </Panel>
      ) : error && !data ? (
        <Panel>
          <ErrorState error={error} onRetry={reload} />
        </Panel>
      ) : (
        <div className="flex flex-col gap-[25px]">
          <Panel>
            <PanelHeading
              title="Site identity"
              description="Used by the footer, contact details and default metadata."
              actions={
                site ? (
                  <Link to="/pages/_site" className={buttonClass('outline', 'sm')}>
                    Edit site details
                  </Link>
                ) : undefined
              }
            />
            {site ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Value label="Company" value={companyName || site.title} />
                <Value label="Email" value={email || 'Not set'} />
                <Value label="Phone" value={phone || 'Not set'} />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/40">
                    Status
                  </p>
                  <div className="mt-1.5">
                    <StatusBadge status={site.status} changed={site.changed} hasPublished={site.hasPublished} />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-obsidian/55">
                The site document has not been seeded yet. Run the seed command before editing details.
              </p>
            )}
          </Panel>

          <NotificationsPanel />

          <div className="grid gap-[25px] xl:grid-cols-2">
            <LinkCard
              icon={Menu}
              title="Navigation"
              description="The header menu, dropdown children and the call-to-action button."
              status={navigation}
              to="/pages/_navigation"
            />
            <LinkCard
              icon={PanelBottom}
              title="Footer"
              description="Footer statement, legal links and the secondary call to action."
              status={footer}
              to="/pages/_footer"
            />
            <LinkCard
              icon={Home}
              title="Home page"
              description="Hero, service highlights, selected work and testimonials."
              status={home}
              to="/pages/_home"
            />
            <LinkCard
              icon={FileText}
              title="Services index"
              description="The copy and hero above the Services collection."
              status={items.find((item) => item.slug === '_services')}
              to="/pages/_services"
            />
            <LinkCard
              icon={BriefcaseBusiness}
              title="Work index"
              description="The Work page hero, grid copy and page size."
              status={items.find((item) => item.slug === '_work')}
              to="/pages/_work"
            />
          </div>

          <div className="grid gap-[25px] xl:grid-cols-[1.35fr_1fr]">
            <Panel>
              <PanelHeading
                title="Administration"
                description="Tools with their own access rules. Items you cannot use are hidden from the sidebar too."
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <ToolLink
                  icon={ImageIcon}
                  title="Media library"
                  description="Upload, alt text, crop focus and usage."
                  to="/media"
                  allowed
                />
                {me?.capabilities.manageForms && (
                  <ToolLink
                    icon={FormInput}
                    title="Forms"
                    description="Notification routing and success copy."
                    to="/forms"
                    allowed
                  />
                )}
                {me?.capabilities.manageUsers && (
                  <ToolLink
                    icon={Users}
                    title="Users"
                    description="Roles and deactivation."
                    to="/users"
                    allowed
                  />
                )}
                {me?.capabilities.viewAudit && (
                  <ToolLink
                    icon={ScrollText}
                    title="Activity log"
                    description="Who changed what, newest first."
                    to="/audit"
                    allowed
                  />
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeading title="Access" />
              <div className="flex items-start gap-3 rounded-card-lg bg-fog/70 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/45">
                  <ShieldCheck size={17} strokeWidth={1.6} />
                </span>
                <div>
                  <p className="text-[13px] font-semibold">Cloudflare Access is the front door</p>
                  <p className="mt-1 text-[12px] leading-5 text-obsidian/55">
                    The CMS never stores passwords. Your Access session is verified on every API
                    request, then this workspace maps your email to a role.
                  </p>
                  <p className="mt-2 break-all font-mono text-[10px] text-obsidian/40">
                    {me?.user.email} · {me?.user.role}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2 text-[12px]">
                <RoleRow role="Admin" detail="Everything, including users, forms and deletion." />
                <RoleRow role="Editor" detail="Create, edit, publish and upload. No settings or users." />
                <RoleRow role="Viewer" detail="Read-only access to content and the inbox." />
              </div>
              <p className="mt-4 text-[11px] leading-5 text-obsidian/45">
                Adding a user here does not grant Access. Add the email to the Access policy for this
                hostname first, then invite them below.
              </p>
            </Panel>
          </div>

          <Panel>
            <PanelHeading title="Environment" />
            <dl className="grid gap-3 text-[12px] sm:grid-cols-2">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                  Public site origin
                </dt>
                <dd className="mt-1 break-all font-mono text-[11px] text-obsidian/65">
                  {me?.siteOrigin ?? 'Not configured'}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                  API surface
                </dt>
                <dd className="mt-1 font-mono text-[11px] text-obsidian/65">/api/admin · /api/public</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                  Content storage
                </dt>
                <dd className="mt-1 text-[12px] text-obsidian/65">Shared D1 database</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-obsidian/40">
                  Media storage
                </dt>
                <dd className="mt-1 text-[12px] text-obsidian/65">Shared R2 bucket · uploads/YYYY/MM</dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}
    </>
  )
}

function NotificationsPanel() {
  const { push } = useToast()
  const { data, loading, error, reload } = useApi<NotificationsSettings>('/settings/notifications')
  const [enabled, setEnabled] = useState(true)
  const [emails, setEmails] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!data) return
    setEnabled(data.enabled)
    setEmails(data.emails.join('\n'))
  }, [data])

  function payload() {
    return {
      enabled,
      emails: emails
        .split(/[\s,;]+/)
        .map((email) => email.trim())
        .filter(Boolean),
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.put('/settings/notifications', payload())
      push({ title: 'Notification settings saved' })
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'Could not save notifications', description: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    try {
      // Test uses the saved settings, so persist what is on screen first.
      await api.put('/settings/notifications', payload())
      const response = await api.post<{ ok: boolean; to: string }>('/settings/test-email')
      push({ title: 'Test email sent', description: response.to })
      reload()
    } catch (cause) {
      push({ tone: 'error', title: 'The test email did not send', description: errorMessage(cause) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Panel>
      <PanelHeading
        title="Notifications"
        description="Who hears about a new submission when the form has no addresses of its own."
        actions={
          <BellRing size={16} strokeWidth={1.6} className="text-obsidian/35" aria-hidden="true" />
        }
      />

      {loading && !data ? (
        <LoadingRows rows={3} />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-4">
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label="Send notification emails"
              description="Turning this off keeps submissions in the inbox and sends nothing."
            />
            <Textarea
              label="Recipients"
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              hint="One email per line, or separated by commas."
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <Button icon={BellRing} size="sm" loading={saving} onClick={() => void save()}>
                Save notifications
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={testing}
                onClick={() => void sendTest()}
              >
                Send test email
              </Button>
            </div>
          </div>

          <div className="rounded-card-lg bg-fog/70 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/40">
              Provider status
            </p>
            <ul className="mt-2 flex flex-col gap-2 text-[12px]">
              <li className="flex items-center justify-between gap-3">
                <span className="text-obsidian/65">Email (Resend)</span>
                {data?.provider.email ? (
                  <Badge tone="mint" dot>
                    Configured
                  </Badge>
                ) : (
                  <Badge tone="outline">Not configured</Badge>
                )}
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-obsidian/65">Turnstile</span>
                {data?.provider.turnstile ? (
                  <Badge tone="mint" dot>
                    Configured
                  </Badge>
                ) : (
                  <Badge tone="outline">Not configured</Badge>
                )}
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-5 text-obsidian/45">
              These indicators are read-only. Secrets live in the deployment environment, never in
              the CMS.
            </p>
          </div>
        </div>
      )}
    </Panel>
  )
}

function LinkCard({
  icon: Icon,
  title,
  description,
  status,
  to,
}: {
  icon: typeof Home
  title: string
  description: string
  status?: DocumentListResponse['items'][number]
  to: string
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-panel bg-white p-[25px] shadow-soft transition-shadow duration-[350ms] hover:shadow-float lg:p-[var(--space-40)]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fog">
        <Icon size={19} strokeWidth={1.5} className="text-obsidian/65" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[16px] font-bold">{title}</span>
          {status ? (
            <StatusBadge status={status.status} changed={status.changed} hasPublished={status.hasPublished} />
          ) : (
            <Badge tone="outline">Not seeded</Badge>
          )}
        </span>
        <span className="mt-1 block text-[12px] leading-5 text-obsidian/55">{description}</span>
      </span>
      <ArrowUpRight
        size={16}
        strokeWidth={1.6}
        className="mt-1 text-obsidian/30 transition-colors group-hover:text-obsidian"
        aria-hidden="true"
      />
    </Link>
  )
}

function ToolLink({
  icon: Icon,
  title,
  description,
  to,
  allowed,
}: {
  icon: typeof ImageIcon
  title: string
  description: string
  to: string
  allowed: boolean
}) {
  if (!allowed) return null
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-card-lg border border-obsidian/10 p-3 transition-colors hover:bg-fog/60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fog">
        <Icon size={15} strokeWidth={1.6} className="text-obsidian/60" />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-obsidian/50">{description}</span>
      </span>
    </Link>
  )
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/40">{label}</p>
      <p className="mt-1 truncate text-[13px] font-medium">{value}</p>
    </div>
  )
}

function RoleRow({ role, detail }: { role: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 rounded-card-lg border border-obsidian/10 px-3 py-2">
      <Wrench size={13} strokeWidth={1.7} className="mt-0.5 shrink-0 text-obsidian/35" aria-hidden="true" />
      <p>
        <span className="font-semibold">{role}</span>
        <span className="text-obsidian/50"> · {detail}</span>
      </p>
    </div>
  )
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}
