import { error } from './http'

/*
 * Roles and the capability matrix (spec §1 "Auth for the admin", §7).
 *
 * Identity comes from exactly one place: the `cms_session` cookie created by
 * POST /api/auth/login, which is checked by
 * `functions/api/admin/_middleware.ts` → `sessionUserFrom`. There is no
 * Cloudflare Access JWT verification and no header-trust path: a caller either
 * presents a valid session for an active `users` row or is rejected.
 *
 * The credentials are the fixed owner account seeded by
 * `npm run db:seed-admin` (ADMIN_EMAIL / ADMIN_PASSWORD → salted PBKDF2 hash in
 * D1). Nothing here invents an identity.
 */

export type Role = 'admin' | 'editor' | 'viewer'

export type User = {
  id: string
  email: string
  name: string | null
  role: Role
}

// --- Roles ------------------------------------------------------------------

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 }

/**
 * The capability matrix (spec §3 Phase 7):
 *
 *   read content / media / submissions ............ viewer
 *   create, edit, publish content; upload media ... editor
 *   submission status + notes ..................... editor
 *   delete submissions/media, SVG upload .......... admin
 *   forms, users, site settings, audit ............ admin
 *
 * Endpoints express this as the minimum role they need; the matrix lives here
 * so it is written once.
 */
export function hasRole(user: User, required: Role): boolean {
  return RANK[user.role] >= RANK[required]
}

/** `null` when allowed; a 403 response when not. */
export function requireRole(user: User, required: Role): Response | null {
  if (hasRole(user, required)) return null
  return error('forbidden', `This action needs the ${required} role`)
}

