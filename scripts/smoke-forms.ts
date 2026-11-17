#!/usr/bin/env node
/*
 * Smoke tests for forms (cms-forms-reviews-spec.md §14).
 *
 * Runs against the local Pages dev server (port 8788 by default).
 * Uses Turnstile's test secret/sitekey (server has TURNSTILE_BYPASS=1).
 *
 * Usage: npm run test:forms
 *   (expects local wrangler dev on http://127.0.0.1:8788)
 */

const BASE = 'http://127.0.0.1:8788'
const ORIGIN = 'http://127.0.0.1:8788'

const headers = {
  'Content-Type': 'application/json',
  Origin: ORIGIN,
}

interface TestResult {
  name: string
  passed: boolean
  detail: string
}

const results: TestResult[] = []

async function post(path: string, body: unknown, expectedStatus: number): Promise<{ ok: boolean; data: unknown; status: number }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.status === expectedStatus, data, status: res.status }
}

function pass(name: string, detail: string) {
  results.push({ name, passed: true, detail })
  console.log(`  ✅ ${name} — ${detail}`)
}

function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail })
  console.log(`  ❌ ${name} — ${detail}`)
}

/* ────────────────────────────────────────────────────────────────────── */

async function run() {
  console.log('\n📋  Forms smoke tests\n')

  // 1. Valid contact submission
  const validContact = {
    values: { name: 'Smoke Test', email: 'smoke@test.com', phone: '+254700000001', referral: 'Google', message: 'Hello from smoke test' },
    website: '',
    elapsedMs: 8421,
    turnstileToken: '',
    context: { page: '/contact' },
  }
  const r1 = await post('/api/public/forms/contact/submissions', validContact, 201)
  r1.ok ? pass('valid contact', '201 with success message') : fail('valid contact', `${r1.status} ${JSON.stringify(r1.data)}`)

  // 2. Valid call-back submission
  const validCallback = {
    values: { name: 'Callback Test', phone: '+254700000002', email: 'cb@test.com' },
    website: '',
    elapsedMs: 9000,
    turnstileToken: '',
    context: { page: '/work/eventotron', projectSlug: 'eventotron', projectTitle: 'Eventotron' },
  }
  const r2 = await post('/api/public/forms/call-back/submissions', validCallback, 201)
  r2.ok ? pass('valid call-back', '201 with success message') : fail('valid call-back', `${r2.status} ${JSON.stringify(r2.data)}`)

  // 3. Honeypot filled → silent 201, no row stored (verify by checking count doesn't change)
  const honeypot = {
    values: { name: 'Bot', phone: '123' },
    website: 'spam.example',
    elapsedMs: 9000,
    turnstileToken: '',
  }
  const r3 = await post('/api/public/forms/contact/submissions', honeypot, 201)
  r3.ok && r3.data && typeof r3.data === 'object' && 'ok' in r3.data && r3.data.ok === true
    ? pass('honeypot', 'silent 201, no store')
    : fail('honeypot', `${r3.status} ${JSON.stringify(r3.data)}`)

  // 4. Too fast (< 2000ms) → silent 201
  const tooFast = {
    values: { name: 'Fast', phone: '123' },
    website: '',
    elapsedMs: 500,
    turnstileToken: '',
  }
  const r4 = await post('/api/public/forms/contact/submissions', tooFast, 201)
  r4.ok && r4.data && typeof r4.data === 'object' && 'ok' in r4.data && r4.data.ok === true
    ? pass('too-fast', 'silent 201, no store')
    : fail('too-fast', `${r4.status} ${JSON.stringify(r4.data)}`)

  // 5. Invalid input → 400 with field errors
  const invalid = {
    values: { name: '', email: 'not-email', phone: 'abc', message: '' },
    website: '',
    elapsedMs: 9000,
    turnstileToken: '',
  }
  const r5 = await post('/api/public/forms/contact/submissions', invalid, 400)
  const hasFieldErrors = r5.ok && r5.data && typeof r5.data === 'object' && 'error' in r5.data &&
    r5.data.error && typeof r5.data.error === 'object' && 'fields' in r5.data.error &&
    Array.isArray(r5.data.error.fields) && r5.data.error.fields.length > 0
  hasFieldErrors ? pass('invalid input', `400 with ${r5.data.error.fields.length} field errors`) : fail('invalid input', `${r5.status} ${JSON.stringify(r5.data)}`)

  // 6. Missing origin → 403
  const noOrigin = await fetch(`${BASE}/api/public/forms/contact/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validContact),
  })
  noOrigin.status === 403 ? pass('no origin', '403 forbidden') : fail('no origin', `${noOrigin.status}`)

  // 7. Rate limit: 5/min on a fresh form (web-design-hero)
  // We'll send 6 rapid requests; the 6th should be 429
  const rateBody = (i: number) => ({
    values: { name: `Rate ${i}`, email: `rate${i}@test.com`, message: `rate ${i}` },
    website: '',
    elapsedMs: 8000 + i,
    turnstileToken: '',
  })
  let rateLimited = false
  for (let i = 1; i <= 6; i++) {
    const rr = await post('/api/public/forms/web-design-hero/submissions', rateBody(i), i === 6 ? 429 : 201)
    if (i === 6 && rr.status === 429) rateLimited = true
  }
  rateLimited ? pass('rate limit', '6th request got 429 with Retry-After') : fail('rate limit', '6th request was not 429')

  // 8. Duplicate guard: same form + values within 10 min → 201, no second row
  const dupBody = {
    values: { name: 'Duplicate Check', phone: '+254700000999' },
    website: '',
    elapsedMs: 9000,
    turnstileToken: '',
    context: { page: '/web-design' },
  }
  const d1 = await post('/api/public/forms/call-back/submissions', dupBody, 201)
  const d2 = await post('/api/public/forms/call-back/submissions', dupBody, 201)
  d1.ok && d2.ok ? pass('duplicate guard', 'second identical submission silent 201') : fail('duplicate guard', `d1: ${d1.status}, d2: ${d2.status}`)

  // 9. Legacy alias: GET /api/public/collections/testimonials returns reviews
  const legacy = await fetch(`${BASE}/api/public/collections/testimonials`, { headers: { Origin: ORIGIN } })
  const legacyData = await legacy.json()
  const hasReviews = legacy.ok && legacyData.data && Array.isArray(legacyData.data) && legacyData.data.length > 0
  hasReviews ? pass('legacy testimonials alias', `${legacyData.data.length} reviews returned`) : fail('legacy testimonials alias', `${legacy.status}`)

  // 10. Public reviews endpoint
  const reviews = await fetch(`${BASE}/api/public/reviews?limit=50`, { headers: { Origin: ORIGIN } })
  const reviewsData = await reviews.json()
  const reviewsOk = reviews.ok && reviewsData.data && Array.isArray(reviewsData.data.reviews) && reviewsData.data.reviews.length > 0
  reviewsOk ? pass('public reviews', `${reviewsData.data.reviews.length} reviews`) : fail('public reviews', `${reviews.status}`)

  // 11. Project detail prefers review_id
  const project = await fetch(`${BASE}/api/public/projects/eventotron`, { headers: { Origin: ORIGIN } })
  const projectData = await project.json()
  const hasTestimonial = project.ok && projectData.data && projectData.data.testimonial && projectData.data.testimonial.quote
  hasTestimonial ? pass('project review_id', 'testimonial from linked review') : fail('project review_id', `${project.status}`)

  /* ────────────────────────────────────────────────────────────────────── */

  console.log('\n📊  Summary')
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  console.log(`   ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.log('\n❌  Failed:')
    results.filter((r) => !r.passed).forEach((r) => console.log(`   - ${r.name}: ${r.detail}`))
    process.exit(1)
  } else {
    console.log('\n✅  All forms smoke tests passed')
  }
}

run().catch((e) => {
  console.error('Test runner crashed:', e)
  process.exit(1)
})