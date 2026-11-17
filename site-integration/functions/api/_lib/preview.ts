/*
 * Draft preview tokens (cms-projects-spec.md §5.1, §11) — vendored from
 * `@marino/api-kit` (packages/api-kit/src/preview.ts) so the site's public
 * functions have no dependency on the CMS workspace. The two must not drift.
 *
 * A token is `base64url(payload).base64url(hmacSHA256(payload))` where the
 * payload is `<slug>.<expiresAtMs>`. It is signed with PREVIEW_SECRET, is short
 * lived (30 minutes) and is only honoured by the public project-detail endpoint
 * — a normal request never accepts one. No secret means no tokens: preview
 * stays unavailable rather than becoming an unsigned/draft leak.
 */

export type PreviewTokenPayload = { slug: string; expiresAt: number }

export function previewSecret(env: { PREVIEW_SECRET?: string }): string | null {
  const secret = env.PREVIEW_SECRET
  return typeof secret === 'string' && secret.length >= 16 ? secret : null
}

export async function verifyPreviewToken(
  env: { PREVIEW_SECRET?: string },
  token: string | null | undefined,
): Promise<PreviewTokenPayload | null> {
  if (!token) return null
  const secret = previewSecret(env)
  if (!secret) return null

  const [encodedPayload, encodedSignature] = token.split('.')
  if (!encodedPayload || !encodedSignature) return null

  let payload: string
  try {
    payload = new TextDecoder().decode(fromBase64url(encodedPayload))
  } catch {
    return null
  }

  const [slug, expiresRaw] = payload.split('.')
  const expiresAt = Number(expiresRaw)
  if (!slug || !Number.isFinite(expiresAt)) return null
  if (expiresAt < Date.now()) return null

  let presented: Uint8Array
  try {
    presented = fromBase64url(encodedSignature)
  } catch {
    return null
  }

  const expected = await hmac(secret, payload)
  if (!timingSafeEqual(presented, expected)) return null

  return { slug, expiresAt }
}

// --- Crypto ------------------------------------------------------------------

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return new Uint8Array(signature)
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}
