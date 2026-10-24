#!/usr/bin/env node
/*
 * Seeds the owner admin account from the environment:
 *   ADMIN_EMAIL, ADMIN_PASSWORD.
 *
 * The CLI never writes the plaintext password: only the salted PBKDF2 hash is
 * passed into SQL, and both secrets are never committed.
 */

import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { pbkdf2Sync } from 'node:crypto'

const root = process.cwd()
const nodeBins = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PBKDF2_ITERATIONS = 210_000

loadDotEnv()

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? ''
const adminPassword = process.env.ADMIN_PASSWORD ?? ''

if (!adminEmail || !EMAIL.test(adminEmail)) {
  console.error('ADMIN_EMAIL must be a valid email address. Set it in .dev.vars or secrets.')
  process.exit(1)
}
if (!adminPassword) {
  console.error('ADMIN_PASSWORD must be set. It should come from .dev.vars or Cloudflare secrets.')
  process.exit(1)
}

const remote = process.argv.includes('--remote')
const persistArgs = remote
  ? []
  : ['--local', '--persist-to', join(root, '.wrangler', 'state')]

const salt = randomBytes(16).toString('hex')
const passwordHash = pbkdf2Sync(adminPassword, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex')
const id = ulid()

const scripts =[
  {
    sql: `SELECT id, password_hash, password_salt FROM users WHERE email COLLATE NOCASE = ${sqlString(adminEmail)};`,
    json: true,
  },
]

const outputs = scripts.map((script) => runWrangler(script))
const existing = JSON.parse(outputs[0])?.[0]?.results?.[0]

if (existing && existing.password_hash && existing.password_salt) {
  const candidateHash = pbkdf2Sync(adminPassword, existing.password_salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex')
  if (candidateHash === existing.password_hash) {
    console.log(`Admin account ${redact(adminEmail)} already exists with the current password. No changes made.`)
    process.exit(0)
  }
  console.log(`Admin account ${redact(adminEmail)} exists but password differs — updating hash.`)
}

const upsert = `
INSERT INTO users (id, email, role, password_hash, password_salt, active)
VALUES (
  ${existing?.id ? sqlString(existing.id) : sqlString(id)},
  ${sqlString(adminEmail)},
  'admin',
  ${sqlString(passwordHash)},
  ${sqlString(salt)},
  1
)
ON CONFLICT(id) DO UPDATE SET
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  active = 1;
`
runWrangler({ sql: upsert })
console.log(`Seeded admin account ${redact(adminEmail)}.`)
process.exit(0)

/* ------------------------------------------------------------------ utils */

function runWrangler(script: { sql: string; json?: boolean }): string {
  const args = [
    nodeBins,
    'd1',
    'execute',
    'DB',
    '--config',
    resolve(root, 'admin', 'wrangler.toml'),
    ...(script.json ? ['--json'] : []),
    '--yes',
    ...persistArgs,
    '--command',
    script.sql,
  ]

  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'wrangler d1 execute failed')
  }
  return result.stdout
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function redact(email: string): string {
  const [ user ] = email.split('@')
  const safe = user.length <= 2 ? '****' : `${user[0]}***`
  return `${safe}@${email.split('@')[1]}`
}

/**
 * Loads `ADMIN_*`/`AUTO_LOGIN` from local `.dev.vars` so the seed script can be
 * run without shell-level env vars; production values come from secrets.
 */
function loadDotEnv(): void {
  const envFile = join(root, '.dev.vars')
  if (!existsSync(envFile)) return
  const raw = readFileSync(envFile, 'utf8')
  const values = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes('=')) continue
    const key = line.slice(0, line.indexOf('=')).trim()
    const value = line.slice(line.indexOf('=') + 1).trim()
    if (key && !values.has(key)) values.set(key, value)
  }
  for (const key of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'AUTO_LOGIN']) {
    const value = values.get(key)
    if (value && !process.env[key]) process.env[key] = value
  }
}

/**
 * ULID + 80-bit random part. Identifier is stable enough to refetch the row.
 */
function ulid(): string {
  const time = Date.now().toString(32).padStart(10, '0').toUpperCase()
  const entropy = randomBytes(10)
    .toString('hex')
    .toUpperCase()
    .match(/.{2}/g)
    ?.map(byte => parseInt(byte, 16).toString(32))
    .join('')
    .padEnd(16, '0')
    .slice(0, 16)
  return time + entropy
}
