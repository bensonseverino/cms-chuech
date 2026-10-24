import { newId } from './ids'
import type { Env } from './types'

/*
 * audit (spec §4.5: "Every write calls audit").
 *
 * An audit write must never fail the request it describes: if the log insert
 * fails, the mutation has already happened, and throwing would turn a
 * successful publish into a 500. Failures are logged loudly instead.
 */

export type AuditAction =
  | 'create'
  | 'update'
  | 'publish'
  | 'unpublish'
  | 'revert'
  | 'delete'
  | 'reorder'
  | 'upload'
  | 'import'
  | 'login'
  | 'logout'
  | 'status'
  | 'bulk'
  | 'purge'

export type AuditActor = { email: string } | null

export async function audit(
  env: Env,
  actor: AuditActor,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  summary = '',
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (id, user_email, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(newId(), actor?.email ?? 'system', action, entityType, entityId, summary)
      .run()
  } catch (cause) {
    console.error('[audit] insert failed', { action, entityType, entityId, cause })
  }
}
