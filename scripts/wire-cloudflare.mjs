#!/usr/bin/env node
/*
 * Writes the real Cloudflare resource ids into every tracked wrangler config.
 *
 * The repo ships `admin/wrangler.toml` and `site-integration/wrangler.toml`
 * with `<...>` placeholders so nothing points at a resource that does not
 * exist yet. Until those are replaced with real ids, a deploy attaches no D1
 * database and every login request dies inside `env.DB.prepare(...)`.
 *
 * Two ways in:
 *
 *   1. Discover from the Cloudflare API (recommended):
 *        CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *          node scripts/wire-cloudflare.mjs --discover
 *      Looks up `marino-cms`, `marino-cms-preview`, the `CACHE` KV namespace
 *      (and its preview sibling) and the `marino-media` R2 bucket by name.
 *
 *   2. Paste the ids, from flags or environment:
 *        node scripts/wire-cloudflare.mjs \
 *          --d1 <database_id> --d1-preview <preview database_id> \
 *          --kv <namespace_id> --kv-preview <preview namespace_id> \
 *          [--r2 marino-media]
 *      Environment equivalents: D1_DATABASE_ID, D1_PREVIEW_DATABASE_ID,
 *      KV_NAMESPACE_ID, KV_PREVIEW_ID, R2_BUCKET_NAME.
 *
 * Optional public origins can be filled the same run: SITE_ORIGIN,
 * CMS_ORIGIN, MEDIA_PUBLIC_BASE, CF_ACCESS_TEAM_DOMAIN.
 *
 * Ids are not secrets, but they identify your account's resources, so this
 * script only ever prints a short prefix of each one.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_CONFIG = join(root, 'admin', 'wrangler.toml')
const SITE_CONFIG = join(root, 'site-integration', 'wrangler.toml')
const D1_NAME = 'marino-cms'
const D1_PREVIEW_NAME = 'marino-cms-preview'
const KV_NAME = 'CACHE'
const R2_NAME = 'marino-media'

const args = process.argv.slice(2)
const flag = (name) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}
const discover = args.includes('--discover')
const sharePreview = args.includes('--share-preview')
const dryRun = args.includes('--dry-run')

const requested = {
  d1: flag('d1') ?? process.env.D1_DATABASE_ID,
  d1Preview: flag('d1-preview') ?? process.env.D1_PREVIEW_DATABASE_ID,
  kv: flag('kv') ?? process.env.KV_NAMESPACE_ID,
  kvPreview: flag('kv-preview') ?? process.env.KV_PREVIEW_ID,
  r2: flag('r2') ?? process.env.R2_BUCKET_NAME ?? R2_NAME,
}

const origins = {
  SITE_ORIGIN: process.env.SITE_ORIGIN,
  CMS_ORIGIN: process.env.CMS_ORIGIN,
  MEDIA_PUBLIC_BASE: process.env.MEDIA_PUBLIC_BASE,
  CF_ACCESS_TEAM_DOMAIN: process.env.CF_ACCESS_TEAM_DOMAIN,
}

const ids = { ...requested }

if (discover) {
  const found = await discoverResources()
  ids.d1 ??= found.d1
  ids.d1Preview ??= found.d1Preview
  ids.kv ??= found.kv
  ids.kvPreview ??= found.kvPreview
  ids.r2 = requested.r2 ?? found.r2 ?? R2_NAME
}

if (!ids.d1 && !ids.kv && !ids.r2) {
  usage('Nothing to write: pass --discover with a CLOUDFLARE_API_TOKEN, or --d1/--kv/--r2 ids.')
}

if (ids.d1Preview === undefined && ids.d1 && sharePreview) {
  ids.d1Preview = ids.d1
  warn(`--share-preview: preview deployments will read and write the production D1 (${D1_NAME}).`)
}
if (ids.kvPreview === undefined && ids.kv && sharePreview) {
  ids.kvPreview = ids.kv
  warn('--share-preview: preview deployments will share the production CACHE namespace.')
}
if (ids.d1 && !ids.d1Preview) {
  usage(
    `No preview D1 id. Create it with:\n` +
      `  npx wrangler d1 create ${D1_PREVIEW_NAME}\n` +
      `then pass --d1-preview <id>, or add --share-preview to reuse production.`,
  )
}
if (ids.kv && !ids.kvPreview) {
  usage(
    `No preview KV id. Create it with:\n` +
      `  npx wrangler kv namespace create ${KV_NAME} --preview\n` +
      `then pass --kv-preview <id>, or add --share-preview to reuse production.`,
  )
}

const writes = []

const admin = rewrite(readFileSync(ADMIN_CONFIG, 'utf8'), 'admin/wrangler.toml')
const site = rewrite(readFileSync(SITE_CONFIG, 'utf8'), 'site-integration/wrangler.toml')

for (const write of writes) {
  const [file, key, before, after] = write
  const shown = `${short(before)} -> ${short(after)}`
  console.log(`  ${file.padEnd(28)} ${key.padEnd(20)} ${shown}`)
}

if (dryRun) {
  console.log('\n--dry-run: no files written.')
  process.exit(0)
}

writeFileSync(ADMIN_CONFIG, admin)
writeFileSync(SITE_CONFIG, site)

// The root config is generated from admin/wrangler.toml for `npm run dev:cms`;
// regenerate it so local development sees the same bindings.
execFileSync(process.execPath, [join(root, 'scripts', 'prepare-local-wrangler.mjs')], {
  cwd: root,
  stdio: 'inherit',
})

assertNoPlaceholders()

console.log(`\nWired ${writes.length} value(s). Next:`)
console.log('  npm run db:migrate:prod')
console.log('  npm run db:seed-admin:remote')
console.log('  npm run smoke:login -- --url https://<your-cms-host>')
process.exit(0)

/* ------------------------------------------------------------------ rewrite */

/**
 * Applies every resolved id to one config file. Each key appears exactly once
 * per file, so the replacement is scoped by key name; `preview_database_id`
 * and `preview_bucket_name` are matched before their shorter siblings.
 */
function rewrite(text, label) {
  let out = text

  const set = (key, value, pattern, optional = false) => {
    if (value === undefined) return
    const regex = pattern ?? new RegExp(`^(\\s*${key}\\s*=\\s*)"[^"]*"$`, 'm')
    const match = out.match(regex)
    // Origins are optional because the two configs declare different subsets.
    if (!match) {
      if (optional) return
      throw new Error(`Could not find "${key}" in ${label}`)
    }
    const before = match[0]
    const after = `${match[1]}"${value}"`
    if (before === after) return
    out = out.replace(regex, () => after)
    writes.push([label, key, before.replace(/^\s*[^=]+=\s*/, ''), `"${value}"`])
  }

  set('preview_database_id', ids.d1Preview)
  set('database_id', ids.d1)
  set('preview_bucket_name', ids.r2)
  set('bucket_name', ids.r2)
  set('preview_id', ids.kvPreview)
  set('id', ids.kv)

  for (const [key, value] of Object.entries(origins)) {
    if (!value) continue
    set(key, value, undefined, true)
  }

  return out
}

/* ----------------------------------------------------------------- discovery */

async function discoverResources() {
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) usage('--discover needs CLOUDFLARE_API_TOKEN in the environment.')

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? (await firstAccount(token))
  console.log(`Account ${accountId.slice(0, 6)}…`)

  const [databases, namespaces, buckets] = await Promise.all([
    api(token, `/accounts/${accountId}/d1/database`),
    api(token, `/accounts/${accountId}/storage/kv/namespaces`),
    api(token, `/accounts/${accountId}/r2/buckets`).catch(() => ({ result: [] })),
  ])

  const dbList = databases.result ?? []
  const kvList = namespaces.result ?? []
  const bucketList = buckets.result ?? []
  const byName = (list, name, key = 'name') =>
    list.find((item) => String(item[key]).toLowerCase() === name.toLowerCase())

  const d1 = byName(dbList, D1_NAME)?.uuid
  const d1Preview = byName(dbList, D1_PREVIEW_NAME)?.uuid
  const kv = byName(kvList, KV_NAME, 'title')?.id
  const kvPreview = kvList.find((item) => /^cache[ _-]?preview/i.test(String(item.title)))?.id
  const r2 = byName(bucketList, R2_NAME)?.name

  for (const [label, value] of [
    [`D1 ${D1_NAME}`, d1],
    [`D1 ${D1_PREVIEW_NAME}`, d1Preview],
    [`KV ${KV_NAME}`, kv],
    [`KV ${KV_NAME} (preview)`, kvPreview],
    [`R2 ${R2_NAME}`, r2],
  ]) {
    console.log(`  ${value ? 'found   ' : 'MISSING '} ${label}${value ? ` ${short(String(value))}` : ''}`)
  }

  return { d1, d1Preview, kv, kvPreview, r2 }
}

async function firstAccount(token) {
  const body = await api(token, '/accounts')
  const account = (body.result ?? [])[0]
  if (!account) throw new Error('This token can see no Cloudflare accounts.')
  return account.id
}

async function api(token, path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    const detail = (body.errors ?? []).map((item) => item.message).join('; ')
    throw new Error(`Cloudflare API ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  return body
}

/* ------------------------------------------------------------------- helpers */

function assertNoPlaceholders() {
  const problems = []
  for (const file of [ADMIN_CONFIG, SITE_CONFIG]) {
    const text = readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!/^\s*(database_id|preview_database_id|id|preview_id|bucket_name|preview_bucket_name)\s*=/.test(line)) continue
      if (line.includes('<')) problems.push(`${file.replace(root, '.')}: ${line.trim()}`)
    }
  }
  if (problems.length) {
    console.error('\nPlaceholders remain:')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
}

function short(value) {
  const text = String(value)
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text
}

function warn(message) {
  console.warn(`warning: ${message}`)
}

function usage(message) {
  console.error(message)
  console.error(
    '\nUsage: node scripts/wire-cloudflare.mjs --discover\n' +
      '       node scripts/wire-cloudflare.mjs --d1 <id> --d1-preview <id> --kv <id> --kv-preview <id> [--r2 <name>]',
  )
  process.exit(1)
}
