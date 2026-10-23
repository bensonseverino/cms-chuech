import type { LucideIcon } from 'lucide-react'
import {
  FileText,
  FormInput,
  History,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  Layers,
  Settings,
  Users,
} from 'lucide-react'
import type { Capabilities } from './api/types'

/*
 * One source of truth for the admin navigation (spec §5.3). The shell renders
 * it; nothing else hard-codes a route label. `end` marks an item that must
 * match the path exactly (so "/" is not active on every screen).
 */
export type NavItem = {
  label: string
  to: string
  icon: LucideIcon
  /** Exact-match the path instead of prefix-match. */
  end?: boolean
  /** Hide the item unless the current role has this capability. */
  capability?: keyof Capabilities
}

export type NavSection = {
  /** Optional group heading, rendered above the items. */
  heading?: string
  items: NavItem[]
}

export const NAV: NavSection[] = [
  {
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true }],
  },
  {
    heading: 'Content',
    items: [
      { label: 'Inbox', to: '/submissions', icon: Inbox },
      { label: 'Pages', to: '/pages', icon: FileText },
      { label: 'Projects', to: '/collections/projects', icon: Layers },
      { label: 'Services', to: '/collections/services', icon: Layers },
      { label: 'Testimonials', to: '/collections/testimonials', icon: Layers },
      { label: 'Clients', to: '/collections/clients', icon: Layers },
      { label: 'Articles', to: '/collections/articles', icon: Layers },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { label: 'Media', to: '/media', icon: ImageIcon },
      { label: 'Forms', to: '/forms', icon: FormInput, capability: 'manageForms' },
      { label: 'Site settings', to: '/settings', icon: Settings, capability: 'manageSettings' },
      { label: 'Users', to: '/users', icon: Users, capability: 'manageUsers' },
      { label: 'Activity', to: '/audit', icon: History, capability: 'viewAudit' },
    ],
  },
]

/** Flat list of nav items, used for title lookup. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((section) => section.items)

/** Role-filtered nav. Empty sections (usually only Settings) are dropped. */
export function navFor(capabilities: Capabilities | undefined): NavSection[] {
  if (!capabilities) return NAV
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.capability || capabilities[item.capability]),
  })).filter((section) => section.items.length > 0)
}

/**
 * Human title for the current path — the top bar shows it (spec §5.1). Matches
 * the longest nav prefix so `/collections/projects/abc` resolves to the
 * Projects entry; falls back to a capitalised last path segment.
 */
export function titleForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((item) =>
    item.end ? item.to === pathname : pathname === item.to || pathname.startsWith(`${item.to}/`),
  ).sort((a, b) => b.to.length - a.to.length)[0]

  if (match) return match.label

  const segment = pathname.split('/').filter(Boolean).pop()
  if (!segment) return 'Dashboard'
  return segment.charAt(0).toUpperCase() + segment.slice(1)
}
