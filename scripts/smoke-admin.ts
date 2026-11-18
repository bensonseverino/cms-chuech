#!/usr/bin/env node
/*
 * Smoke tests for the admin forms/reviews API (cms-forms-reviews-spec.md §6/§10).
 *
 * Logs in with the .dev.vars credentials, then exercises the inbox endpoints,
 * the reviews CRUD, reorder and bulk actions, and the notifications settings.
 * Runs against the local Pages dev server serving the ADMIN functions
 * (default http://127.0.0.1:8787).
 *
 * Usage: npm run test:admin
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.ADMIN_URL ?? 'http://127.0.0.1:8787'

const devVars = {}
const devVarsPath = join(root, '.dev.vars')
if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const key = line.slice(0, line.indexOf('=')).trim()
    if (key) devVars[key] = line.slice(line.indexOf('=') + 1).trim()
  }
}
const EMAIL = devVars.ADMIN_EMAIL ?? ''
const PASSWORD = devVars.ADMIN_PASSWORD ?? ''

const results = []
let cookie = ''

function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function request(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      ...(cookie ? { Cookie: cookie.split(';')[0] } : {}),
      ...(init.headers ?? {}),
    },
  })
  const setCookie =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // Non-JSON error pages are reported through status checks.
  }
  return { status: response.status, json, headers: response.headers, setCookie }
}

async function run() {
  console.log('\n📋  Admin API smoke tests\n')

  // 0. Login
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  cookie = (login.setCookie ?? []).find((value) => value.startsWith('cms_session=')) ?? ''
  check('login', login.status === 200 && cookie !== '', `HTTP ${login.status}`)

  // 1. Unread count
  const unread = await request('/api/admin/submissions/unread-count')
  check(
    'unread-count',
    unread.status === 200 && typeof unread.json?.count === 'number',
    `count=${unread.json?.count}`,
  )
  check('unread-count no-store', (unread.headers.get('Cache-Control') ?? '').includes('no-store'))

  // 2. Inbox list with unread/starred filters
  const list = await request('/api/admin/submissions?limit=5&unread=1')
  check('inbox unread filter', list.status === 200 && Array.isArray(list.json?.items))
  const listStarred = await request('/api/admin/submissions?limit=5&starred=1')
  check('inbox starred filter', listStarred.status === 200 && Array.isArray(listStarred.json?.items))

  // 3. Star + read the first submission, then verify
  const first = list.json?.items?.[0] ?? (await request('/api/admin/submissions?limit=1')).json?.items?.[0]
  if (first) {
    const patched = await request(`/api/admin/submissions/${first.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isStarred: true, read: true }),
    })
    check(
      'patch star+read',
      patched.status === 200 && patched.json?.item?.isStarred === true && typeof patched.json?.item?.readAt === 'string',
      `HTTP ${patched.status}`,
    )
    // Undo (leave the seed data as it was).
    await request(`/api/admin/submissions/${first.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isStarred: false, read: false }),
    })
  } else {
    check('patch star+read', false, 'no submissions in the inbox to test with')
  }

  // 4. Bulk archive + restore
  if (first) {
    const archive = await request('/api/admin/submissions/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [first.id], action: 'archive' }),
    })
    check('bulk archive', archive.status === 200 && archive.json?.updated === 1, `HTTP ${archive.status}`)
    const restore = await request('/api/admin/submissions/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [first.id], action: 'restore' }),
    })
    check('bulk restore', restore.status === 200 && restore.json?.updated === 1, `HTTP ${restore.status}`)
  } else {
    check('bulk archive/restore', false, 'no submissions to test with')
  }

  // 5. Reviews list
  const reviews = await request('/api/admin/reviews')
  check(
    'reviews list',
    reviews.status === 200 && Array.isArray(reviews.json?.items) && reviews.json.items.length > 0,
    `${reviews.json?.items?.length ?? 0} reviews`,
  )

  // 6. Create a review
  const created = await request('/api/admin/reviews', {
    method: 'POST',
    body: JSON.stringify({
      quote: 'Smoke test quote from the admin API.',
      authorName: 'Smoke Author',
      company: 'Smoke Co',
      rating: 5,
    }),
  })
  const reviewId = created.json?.item?.id
  check('review create', created.status === 201 && Boolean(reviewId), `HTTP ${created.status}`)

  // 7. Validation: bad source URL and out-of-range rating are rejected
  const badUrl = await request('/api/admin/reviews', {
    method: 'POST',
    body: JSON.stringify({ quote: 'x', authorName: 'y', sourceUrl: 'http://insecure.example' }),
  })
  check('review source_url https', badUrl.status === 400, `HTTP ${badUrl.status}`)
  const badRating = await request('/api/admin/reviews', {
    method: 'POST',
    body: JSON.stringify({ quote: 'x', authorName: 'y', rating: 9 }),
  })
  check('review rating 1-5', badRating.status === 400, `HTTP ${badRating.status}`)

  // 8. Update + reorder + bulk
  if (reviewId) {
    const updated = await request(`/api/admin/reviews/${reviewId}`, {
      method: 'PUT',
      body: JSON.stringify({ quote: 'Smoke test quote, edited.', isFeatured: true }),
    })
    check('review update', updated.status === 200 && updated.json?.item?.isFeatured === true, `HTTP ${updated.status}`)

    const ids = reviews.json.items.map((item) => item.id)
    const reordered = await request('/api/admin/reviews/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids: [reviewId, ...ids.filter((id) => id !== reviewId)] }),
    })
    check('review reorder', reordered.status === 200, `HTTP ${reordered.status}`)

    const afterReorder = await request('/api/admin/reviews')
    check(
      'review order applied',
      afterReorder.json?.items?.[0]?.id === reviewId,
      afterReorder.json?.items?.[0]?.id ?? 'none',
    )
  }

  // 9. Notifications settings GET/PUT
  const settings = await request('/api/admin/settings/notifications')
  check('settings get', settings.status === 200 && typeof settings.json?.enabled === 'boolean' && typeof settings.json?.provider === 'object')
  const saved = await request('/api/admin/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify({ enabled: true, emails: ['hello@chuechstudio.co.ke'] }),
  })
  check('settings put', saved.status === 200 && saved.json?.emails?.length === 1, `HTTP ${saved.status}`)

  // 10. Test email endpoint (no Resend key locally → a clean 400, not a crash)
  const testEmail = await request('/api/admin/settings/test-email', { method: 'POST', body: '{}' })
  check(
    'test email handled',
    testEmail.status === 200 || testEmail.status === 400,
    `HTTP ${testEmail.status} ${testEmail.json?.error?.message ?? ''}`,
  )

  // 11. Forms PUT: field validation (unique ids + key regex)
  const forms = await request('/api/admin/forms')
  const formSource = forms.json?.items?.[0]?.source
  if (formSource) {
    const badFields = await request(`/api/admin/forms/${formSource}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: [{ id: '9bad key', type: 'text', label: 'X' }] }),
    })
    check('form field key regex', badFields.status === 400, `HTTP ${badFields.status}`)
    const dupFields = await request(`/api/admin/forms/${formSource}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [
          { id: 'name', type: 'text', label: 'Name' },
          { id: 'name', type: 'text', label: 'Name again' },
        ],
      }),
    })
    check('form field ids unique', dupFields.status === 409, `HTTP ${dupFields.status}`)
  } else {
    check('forms list', false, 'no forms to test with')
  }

  // 12. Cleanup: delete the smoke review
  if (reviewId) {
    const deleted = await request(`/api/admin/reviews/${reviewId}`, { method: 'DELETE' })
    check('review delete', deleted.status === 200, `HTTP ${deleted.status}`)
  }

  console.log('\n📊  Summary')
  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`   ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  console.log('\n✅  All admin API smoke tests passed')
}

run().catch((cause) => {
  console.error('Test runner crashed:', cause)
  process.exit(1)
})
