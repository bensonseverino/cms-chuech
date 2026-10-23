import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { Loader2, Menu, ShieldAlert, X } from 'lucide-react'
import type { Capabilities, User } from '../api/types'
import { navFor, titleForPath, type NavSection } from '../nav'
import { useAuth } from '../providers/AuthProvider'
import { Button } from './ui'
import { initials } from '../lib/format'

/*
 * Admin shell (spec §5.1). Black sidebar, 264px, `primary` fill on the active
 * item with `obsidian` text; transparent 72px top bar over `fog`. Below 1024px
 * the sidebar becomes a top bar with a glass drawer — the same nav, one markup
 * tree, so the two never drift.
 *
 * Auth lives here because the shell is the first thing that needs the identity:
 * the nav is filtered by capability, and the user card is always visible. The
 * API still enforces every capability; hiding a link is presentation, not
 * security.
 */
export default function AdminShell() {
  const { pathname } = useLocation()
  const { me, loading, error, reload } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Close the drawer on navigation and return focus to the menu button.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    closeButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        menuButtonRef.current?.focus()
        return
      }

      if (event.key !== 'Tab') return
      const drawer = closeButtonRef.current?.closest('nav')
      if (!drawer) return
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  if (loading && !me) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-fog p-6">
        <div className="flex w-full max-w-[360px] flex-col items-center gap-5 rounded-panel bg-obsidian px-8 py-10 text-white">
          <span className="text-[18px] font-bold tracking-[0.18em]">CHUECH</span>
          <span className="flex items-center gap-2 text-[12px] text-white/60">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            Verifying Access session…
          </span>
        </div>
      </div>
    )
  }

  if (error && !me) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-fog p-6">
        <div className="w-full max-w-[460px] rounded-panel bg-white p-[var(--space-40)] shadow-soft">
          <span className="mb-6 block text-[18px] font-bold tracking-[0.18em] text-obsidian">
            CHUECH
          </span>
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-obsidian text-white">
            <ShieldAlert size={20} strokeWidth={1.6} />
          </span>
          <h1 className="text-[24px] font-bold leading-tight">The CMS could not open</h1>
          <p className="mt-2 text-[13px] leading-6 text-obsidian/60">{error.message}</p>
          <p className="mt-3 rounded-card-lg bg-fog p-3 text-[11px] leading-5 text-obsidian/50">
            This application is protected by Cloudflare Access. If your session expired, reload to
            sign in again. If you are signed in, ask an admin to add your email to the CMS users
            table.
          </p>
          <Button className="mt-5" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!me) return null

  const nav = navFor(me.capabilities)
  const title = titleForPath(pathname)

  function closeDrawer() {
    setDrawerOpen(false)
    menuButtonRef.current?.focus()
  }

  return (
    <div className="min-h-svh bg-fog font-sans text-obsidian">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-[25px] focus:top-[25px] focus:z-50 focus:rounded-button focus:bg-obsidian focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      {/* Sidebar — desktop only. */}
      <nav
        aria-label="Admin"
        className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col bg-black px-[25px] py-[25px] text-white lg:flex"
      >
        <div className="mb-[25px]">
          <Wordmark />
        </div>
        <SidebarNav nav={nav} pathname={pathname} />
        <UserCard user={me.user} />
      </nav>

      {/* Mobile top bar + drawer. */}
      <div className="sticky top-0 z-30 flex h-[var(--topbar-height)] items-center gap-4 bg-fog px-[25px] lg:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="flex h-11 w-11 items-center justify-center rounded-button text-obsidian transition-colors duration-[350ms] ease-[var(--ease-standard)] hover:bg-white/60"
        >
          <Menu size={18} strokeWidth={1.5} />
        </button>
        <h1 className="truncate text-[28px] font-bold">{title}</h1>
        <span className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-obsidian text-[10px] font-bold text-white">
          {initials(me.user.name || me.user.email)}
        </span>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} aria-hidden="true" />
          <nav
            aria-label="Admin"
            className="absolute inset-y-0 left-0 flex w-[var(--sidebar-width)] flex-col bg-black/95 px-[25px] py-[25px] text-white backdrop-blur"
          >
            <div className="mb-[25px] flex items-center justify-between">
              <Wordmark />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center rounded-button transition-colors duration-[350ms] ease-[var(--ease-standard)] hover:bg-white/10"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>
            <SidebarNav
              nav={nav}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
            <UserCard user={me.user} onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </div>
      )}

      <div className="lg:pl-[var(--sidebar-width)]">
        {/* Top bar — desktop. Transparent over fog. */}
        <div className="hidden h-[var(--topbar-height)] items-center gap-4 px-[var(--space-40)] lg:flex">
          <h1 className="text-[33px] font-bold">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            <span className="rounded-pill border border-obsidian/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian/55">
              {me.user.role}
            </span>
            <span className="hidden text-[12px] text-obsidian/55 xl:block">{me.user.email}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-obsidian text-[10px] font-bold text-white">
              {initials(me.user.name || me.user.email)}
            </span>
          </div>
        </div>

        <main
          id="admin-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[var(--content-max)] px-[25px] pb-[var(--space-40)] pt-[25px] focus:outline-none lg:px-[var(--space-40)] lg:pt-0"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarNav({
  nav,
  pathname,
  onNavigate,
}: {
  nav: NavSection[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-[25px] overflow-y-auto">
      {nav.map((section, index) => (
        <div key={section.heading ?? `section-${index}`}>
          {section.heading && (
            <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
              {section.heading}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {section.items.map((item) => {
              const isActive = item.end
                ? pathname === item.to
                : pathname === item.to || pathname.startsWith(`${item.to}/`)
              const Icon = item.icon
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    className={() =>
                      [
                        'flex h-11 items-center gap-3 rounded-button px-4 text-sm font-medium',
                        'transition-colors duration-[350ms] ease-[var(--ease-standard)]',
                        isActive ? 'bg-primary text-obsidian' : 'text-white hover:bg-white/10',
                      ].join(' ')
                    }
                  >
                    <Icon size={18} strokeWidth={1.5} />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function UserCard({
  user,
  onNavigate,
}: {
  user: User
  onNavigate?: () => void
}) {
  return (
    <div className="mt-5 border-t border-white/10 pt-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-obsidian">
          {initials(user.name || user.email)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-semibold text-white">
            {user.name || user.email}
          </span>
          <span className="block truncate text-[10px] uppercase tracking-[0.1em] text-white/45">
            {user.role}
          </span>
        </span>
      </div>
      <a
        href="/cdn-cgi/access/logout"
        onClick={onNavigate}
        className="mt-3 flex h-9 items-center justify-center rounded-button border border-white/15 text-[11px] font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white"
      >
        Sign out
      </a>
    </div>
  )
}

function Wordmark() {
  return <span className="text-[18px] font-bold tracking-[0.18em] text-white">CHUECH</span>
}

// Capabilities are referenced by the prop type so the shell and nav stay in
// sync if a future screen adds a new gated section.
export type ShellCapabilities = Capabilities
