import {
  audit,
  json,
  requireRole,
  type Env,
  type PagesFunction,
} from '@marino/api-kit'
import { actorOf, currentUser } from '../_lib/db'
import { run } from '../_lib/http'

/*
 * DELETE /api/admin/submissions/spam — empty the spam folder (admin only,
 * forms-reviews spec §6). Everything with status = 'spam' is gone for good;
 * the UI asks for confirmation first.
 */

export const onRequestDelete: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const result = await context.env.DB.prepare(
      "DELETE FROM submissions WHERE status = 'spam'",
    ).run()

    const deleted = Number((result.meta as { changes?: number }).changes ?? 0)

    await audit(
      context.env,
      actorOf(user),
      'bulk',
      'submission',
      null,
      `Emptied the spam folder (${deleted} submission${deleted === 1 ? '' : 's'})`,
    )

    return json({ ok: true, deleted })
  })
