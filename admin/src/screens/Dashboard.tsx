import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowRight,
  CheckCircle2,
  FilePlus2,
  FormInput,
  Inbox,
  Layers,
  Upload,
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import type { DashboardResponse, HealthResponse } from '../api/types'
import { useAuth } from '../providers/AuthProvider'
import { ErrorState, LoadingRows, Panel, PanelHeading, buttonClass } from '../components/ui'
import { formatBytes, relativeTime } from '../lib/format'

/*
 * Dashboard (spec §5.3 `/`): four operational cards, the latest inbox items
 * and the latest activity. The health strip reports the three bindings without
 * hiding the rest of the screen when one is down.
 */

const CARDS = [
  { key: 'newSubmissions', label: 'New submissions', hint: 'Unread since your last visit' },
  { key: 'unpublishedChanges', label: 'Unpublished changes', hint: 'Draft differs from the snapshot' },
  { key: 'drafts', label: 'Drafts', hint: 'Records never published' },
  { key: 'mediaBytes', label: 'Storage used', hint: 'Media in the shared R2 bucket' },
] as const

export default function Dashboard() {
  const { me } = useAuth()
  const { data, error, loading, reload } = useApi<DashboardResponse>('/dashboard')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/admin/health', { credentials: 'same-origin' })
      .then(async (response) => {
        const contentType = response.headers.get('Content-Type') ?? ''
        if (!contentType.includes('application/json')) {
          throw new Error('Health endpoint returned a non-JSON response')
        }
        const parsed = (await response.json()) as HealthResponse
        if (active) setHealth(parsed)
      })
      .catch(() => {
        if (active) setHealthError(true)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading && !data) {
    return (
      <Panel>
        <LoadingRows rows={6} />
      </Panel>
    )
  }

  if (error && !data) {
    return (
      <Panel>
        <ErrorState error={error} onRetry={reload} />
      </Panel>
    )
  }

  const cards = data?.cards

  return (
    <div className="flex flex-col gap-[25px]">
      <div className="grid gap-[25px] sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((card) => (
          <section
            key={card.key}
            className="rounded-panel bg-white p-[25px] shadow-soft"
            aria-label={card.label}
          >
            <h2 className="text-[13px] font-semibold text-obsidian/65">{card.label}</h2>
            <p className="mt-3 text-[42px] font-bold leading-none tracking-[-0.03em]">
              {card.key === 'mediaBytes'
                ? formatBytes(cards?.mediaBytes ?? 0)
                : (cards?.[card.key] ?? 0)}
            </p>
            <p className="mt-3 text-[11px] leading-4 text-obsidian/45">{card.hint}</p>
          </section>
        ))}
      </div>

      <section className="grid gap-[25px] xl:grid-cols-[1.35fr_1fr]">
        <Panel>
          <PanelHeading
            title="Latest submissions"
            description="Unread rows carry a mint dot."
            actions={
              <Link to="/submissions" className={buttonClass('outline', 'sm')}>
                Open inbox
                <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            }
          />
          {data?.recentSubmissions.length ? (
            <ul className="flex flex-col">
              {data.recentSubmissions.map((submission) => (
                <li key={submission.id} className="border-t border-obsidian/10 first:border-t-0">
                  <Link
                    to={`/submissions/${submission.id}`}
                    className="flex items-center gap-3 py-3.5 transition-colors hover:text-obsidian"
                  >
                    <span
                      className={[
                        'h-2 w-2 shrink-0 rounded-full',
                        submission.status === 'new' ? 'bg-primary' : 'bg-obsidian/15',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span
                          className={[
                            'truncate text-[13px]',
                            submission.status === 'new' ? 'font-bold' : 'font-medium',
                          ].join(' ')}
                        >
                          {submission.name || submission.email || 'Anonymous submission'}
                        </span>
                        <span className="text-[11px] text-obsidian/45">
                          {submission.formLabel ?? submission.source}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-obsidian/55">
                        {submission.message || 'No message'}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-obsidian/40 sm:block">
                      {relativeTime(submission.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-[13px] text-obsidian/45">No submissions yet.</p>
          )}
        </Panel>

        <div className="flex flex-col gap-[25px]">
          <Panel>
            <PanelHeading title="Quick actions" />
            <div className="grid gap-2">
              {me?.capabilities.editContent && (
                <Link to="/pages" className={buttonClass('outline', 'md', 'justify-start')}>
                  <FilePlus2 size={16} strokeWidth={1.7} aria-hidden="true" />
                  New page
                </Link>
              )}
              <Link to="/collections/projects" className={buttonClass('outline', 'md', 'justify-start')}>
                <Layers size={16} strokeWidth={1.7} aria-hidden="true" />
                Project entries
              </Link>
              {me?.capabilities.upload && (
                <Link to="/media" className={buttonClass('outline', 'md', 'justify-start')}>
                  <Upload size={16} strokeWidth={1.7} aria-hidden="true" />
                  Upload media
                </Link>
              )}
              {me?.capabilities.manageForms && (
                <Link to="/forms" className={buttonClass('outline', 'md', 'justify-start')}>
                  <FormInput size={16} strokeWidth={1.7} aria-hidden="true" />
                  Form settings
                </Link>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeading
              title="System"
              actions={
                health?.ok ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-obsidian/60">
                    <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden="true" />
                    Healthy
                  </span>
                ) : health ? (
                  <span className="text-[11px] font-semibold text-obsidian/60">Needs attention</span>
                ) : (
                  <span className="text-[11px] font-semibold text-obsidian/60">
                    {healthError ? 'Unavailable' : 'Checking'}
                  </span>
                )
              }
            />
            <ul className="flex flex-col gap-2 text-[12px]">
              {health
                ? Object.entries(health.bindings).map(([name, probe]) => (
                    <li key={name} className="flex items-center justify-between gap-3">
                      <span className="font-medium uppercase tracking-[0.08em] text-obsidian/50">
                        {name}
                      </span>
                      <span className="flex items-center gap-1.5 text-obsidian/65">
                        <span
                          className={[
                            'h-1.5 w-1.5 rounded-full',
                            probe.ok ? 'bg-primary' : 'bg-obsidian',
                          ].join(' ')}
                          aria-hidden="true"
                        />
                        {probe.detail}
                      </span>
                    </li>
                  ))
                : (
                    <li className="text-obsidian/50">
                      {healthError ? 'Health endpoint did not respond.' : 'Checking bindings…'}
                    </li>
                  )}
            </ul>
          </Panel>
        </div>
      </section>

      {me?.capabilities.viewAudit && (
        <Panel>
          <PanelHeading
            title="Recent activity"
            description="Every write is recorded."
            actions={
              <Link to="/audit" className={buttonClass('ghost', 'sm')}>
                View all
              </Link>
            }
          />
          {data?.recentAudit.length ? (
            <ul className="flex flex-col">
              {data.recentAudit.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-obsidian/10 py-3 text-[12px] first:border-t-0"
                >
                  <span className="font-mono text-[11px] text-obsidian/45">{entry.userEmail}</span>
                  <span className="font-medium">{entry.action}</span>
                  <span className="text-obsidian/60">{entry.entityType}</span>
                  <span className="min-w-0 flex-1 truncate text-obsidian/55">{entry.summary}</span>
                  <span className="text-obsidian/35">{relativeTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-[13px] text-obsidian/45">No activity recorded yet.</p>
          )}
        </Panel>
      )}

      {data && data.cards.newSubmissions > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-obsidian px-[25px] py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-obsidian">
              <Inbox size={16} strokeWidth={1.8} />
            </span>
            <p className="text-sm font-medium">
              {data.cards.newSubmissions} new submission
              {data.cards.newSubmissions === 1 ? '' : 's'} waiting in the inbox.
            </p>
          </div>
          <Link to="/submissions?status=new" className={buttonClass('primary', 'sm')}>
            Review
            <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  )
}
