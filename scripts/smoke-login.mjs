#!/usr/bin/env node
/*
 * End-to-end auth smoke test: proves the deployed CMS can actually sign a user
 * in and that the admin API accepts the session it hands back.
 *
 * It exercises the exact three requests the SPA's boot sequence makes:
 *
 *   POST /api/auth/login   -> must be 200 and set the `cms_session` cookie
 *   GET  /api/admin/me     -> must be 200 with the signed-in user + capabilities
 *   GET  /api/admin/health -> must be 200 (bindings reachable)
 *
 * A 500 on login means the D1 binding is missing (unwired ids); a 401 on
 * /api/admin/me with a fresh cookie means the session lookup itself is broken.
 *
 * Usage:
 *   node scripts/smoke-login.mjs [--url https://cms.example.com]
 *                                [--email you@example.com] [--password secret]
 *
 * Defaults: --url from CMS_URL, else CMS_ORIGIN in admin/wrangler.toml, else
 * http://127.0.0.1:8788. Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD,
 * falling back to `.dev.vars` for local runs.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}

const devVars = readDevVars()
const baseUrl = normalise(
  flag('url') ?? process.env.CMS_URL ?? cmsOriginFromConfig() ?? 'http://127.0.0.1:8788',
)
const email = (flag('email') ?? process.env.ADMIN_EMAIL ?? devVars.ADMIN_EMAIL ?? '').trim()
const password = flag('password') ?? process.env.ADMIN_PASSWORD ?? devVars.ADMIN_PASSWORD ?? ''
const expectFailure = args.includes('--expect-failure')

if (!email || !password) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required (flags, environment or .dev.vars).')
  process.exit(2)
}

console.log(`Target      ${baseUrl}`)
console.log(`Account     ${redact(email)}`)
console.log('')

const results = []
let cookie = ''

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: baseUrl },
  body: JSON.stringify({ email, password }),
})

if (expectFailure) {
  check('login rejected', login.status === 401 || login.status === 403, `HTTP ${login.status}`, login.text)
  finish()
}

check('login', login.status === 200, `HTTP ${login.status}`, login.text)
cookie = (login.setCookie ?? []).find((value) => value.startsWith('cms_session='))
if (!cookie) {
  check('session cookie', false, 'no cms_session cookie in Set-Cookie', JSON.stringify(login.setCookie))
  finish()
}
check('session cookie', true, 'cms_session set')

const me = await request('/api/admin/me', { headers: { Origin: baseUrl, Cookie: cookie.split(';')[0] } })
check('GET /api/admin/me', me.status === 200, `HTTP ${me.status}`, me.text)

const user = me.json?.user
check(
  'identified user',
  typeof user?.email === 'string' && user.email.toLowerCase() === email.toLowerCase(),
  user?.email ?? 'no user in body',
)
check(
  'capabilities',
  typeof me.json?.capabilities === 'object' && me.json?.capabilities !== null,
  Object.keys(me.json?.capabilities ?? {}).length
    ? `${Object.keys(me.json.capabilities).length} flags`
    : 'missing capabilities object',
)

const health = await request('/api/admin/health', { headers: { Origin: baseUrl } })
check('GET /api/admin/health', health.status === 200, `HTTP ${health.status}`, health.text)

finish()

/* -------------------------------------------------------------------- utils */

function check(name, ok, detail, body) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok && body) console.log(`      ${String(body).slice(0, 400)}`)
}

function finish() {
  const failed = results.filter((result) => !result.ok)
  console.log('')
  if (failed.length) {
    console.log(`${failed.length} check(s) failed.`)
    process.exit(1)
  }
  console.log(`All ${results.length} checks passed.`)
  process.exit(0)
}

async function request(path, init = {}) {
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init })
  } catch (cause) {
    return { status: 0, text: `network error: ${cause instanceof Error ? cause.message : cause}`, json: null, setCookie: [] }
  }
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // non-JSON (Pages 404 page, Access interstitial) is reported as-is
  }
  const setCookie =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
  return { status: response.status, text, json, setCookie }
}

function readDevVars() {
  const file = join(root, '.dev.vars')
  if (!existsSync(file)) return {}
  const values = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const key = line.slice(0, line.indexOf('=')).trim()
    if (key) values[key] = line.slice(line.indexOf('=') + 1).trim()
  }
  return values
}

function cmsOriginFromConfig() {
  const file = join(root, 'admin', 'wrangler.toml')
  if (!existsSync(file)) return undefined
  const match = readFileSync(file, 'utf8').match(/^\s*CMS_ORIGIN\s*=\s*"([^"]+)"/m)
  const value = match?.[1]
  return value && /^https?:\/\//.test(value) && !value.includes('example.com') ? value : undefined
}

function normalise(url) {
  return url.trim().replace(/\/+$/, '')
}

function redact(value) {
  const [user, domain] = value.split('@')
  if (!domain) return '****'
  return `${user.length <= 2 ? '**' : `${user[0]}***`}@${domain}`
}
