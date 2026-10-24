import type { Env, PagesFunction } from '@marino/api-kit'
import { logout } from './_lib/auth'

/** POST /api/auth/logout — invalidates the current session row and clears the cookie. */
export const onRequestPost: PagesFunction<Env> = async (context) =>
  logout(context.request, context.env)
