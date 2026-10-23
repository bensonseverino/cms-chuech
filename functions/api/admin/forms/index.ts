import { json, requireRole, type Env, type PagesFunction } from '@marino/api-kit'
import { currentUser } from '../_lib/db'
import { FORM_SELECT, formView, type FormRow } from '../_lib/forms'
import { run } from '../_lib/http'

/*
 * GET /api/admin/forms — every registered source and its inbox counts.
 *
 * Forms are admin-only (the capability matrix): an editor can read the inbox
 * but does not change where a form is routed.
 */

export const onRequestGet: PagesFunction<Env> = (context) =>
  run(async () => {
    const user = currentUser(context)
    const roleError = requireRole(user, 'admin')
    if (roleError) return roleError

    const { results } = await context.env.DB.prepare(
      `${FORM_SELECT} ORDER BY f.source COLLATE NOCASE`,
    ).all<FormRow>()

    return json({ items: (results ?? []).map(formView) })
  })
