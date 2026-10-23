import { ADMIN_HEADERS, json, type Env, type PagesFunction } from '@marino/api-kit'

/*
 * GET /api/admin/health — checks that the three bindings are attached
 * (spec §3 Phase 7 endpoint table).
 *
 * This is the one admin route that does NOT sit behind the auth middleware's
 * identity lookup reaching into the database: it is the endpoint you call when
 * something is misconfigured, so it reports per-binding status rather than
 * failing as a whole. It still requires whatever Access rule protects
 * `cms.<domain>`, and it never reveals configuration values — only the shape of
 * `MEDIA_PUBLIC_BASE` is echoed, which is public anyway.
 */

type Probe = { ok: boolean; detail: string }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [db, media, kv] = await Promise.all([probeDb(env), probeMedia(env), probeKv(env)])
  const ok = db.ok && media.ok && kv.ok

  return json(
    {
      ok,
      bindings: { db, media, kv },
      mediaPublicBase: env.MEDIA_PUBLIC_BASE,
    },
    { status: ok ? 200 : 503, headers: ADMIN_HEADERS },
  )
}

async function probeDb(env: Env): Promise<Probe> {
  try {
    const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>()
    return row?.one === 1
      ? { ok: true, detail: 'D1 reachable' }
      : { ok: false, detail: 'D1 returned an unexpected row' }
  } catch (cause) {
    return { ok: false, detail: `D1 error: ${message(cause)}` }
  }
}

async function probeMedia(env: Env): Promise<Probe> {
  try {
    // A one-item list is the cheapest read that proves the binding is live.
    await env.MEDIA.list({ limit: 1 })
    return { ok: true, detail: 'R2 reachable' }
  } catch (cause) {
    return { ok: false, detail: `R2 error: ${message(cause)}` }
  }
}

async function probeKv(env: Env): Promise<Probe> {
  try {
    const value = await env.CACHE.get('content_version')
    return {
      ok: true,
      detail: value === null ? 'KV reachable, no content_version set yet' : 'KV reachable',
    }
  } catch (cause) {
    return { ok: false, detail: `KV error: ${message(cause)}` }
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
