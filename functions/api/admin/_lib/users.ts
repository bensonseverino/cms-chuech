import type { Env } from '@marino/api-kit'

/*
 * User-row helpers shared by the list and one-user endpoints.
 */

export type UserRow = {
  id: string
  email: string
  name: string | null
  role: string
  active: number
  last_login_at: string | null
  created_at: string
}

export type UserView = {
  id: string
  email: string
  name: string | null
  role: string
  active: boolean
  lastLoginAt: string | null
  createdAt: string
}

export const ROLES = new Set(['admin', 'editor', 'viewer'])
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const USER_SELECT =
  'SELECT id, email, name, role, active, last_login_at, created_at FROM users'

export function userView(row: UserRow): UserView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active === 1,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  }
}

export async function loadUser(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare(`${USER_SELECT} WHERE id = ?`).bind(id).first<UserRow>()
}

export async function otherActiveAdmins(env: Env, excludeId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM users
      WHERE active = 1 AND role = 'admin' AND id != ?`,
  )
    .bind(excludeId)
    .first<{ count: number }>()
  return row?.count ?? 0
}
