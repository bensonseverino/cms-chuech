/*
 * Client-side responsive variants (cms-projects-spec.md §6).
 *
 * The original never leaves the browser at full resolution: we decode it with
 * `createImageBitmap`, draw it down to the widths the page actually uses, and
 * upload WebP renditions. Widths larger than the original are skipped (never
 * upscale) and the native width is always included as the largest rendition.
 *
 * GIF and SVG are stored as-is: resizing them would lose animation or vector
 * sharpness, so the uploader falls back to the plain media endpoint.
 */

export const VARIANT_WIDTHS = [480, 768, 1200, 1920] as const

export type ImageVariant = { width: number; blob: Blob }

export type PreparedImage = {
  variants: ImageVariant[]
  width: number
  height: number
}

export function canResize(file: File): boolean {
  const type = file.type.toLowerCase()
  return (
    (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') &&
    typeof createImageBitmap === 'function'
  )
}

export async function prepareProjectImage(file: File): Promise<PreparedImage | null> {
  if (!canResize(file)) return null

  const bitmap = await createImageBitmap(file)
  try {
    const standards = VARIANT_WIDTHS.filter((width) => width < bitmap.width)
    // Keep the request to four parts: the three largest standard widths plus
    // the native size (which becomes the primary file).
    const widths = [...standards.slice(-3), bitmap.width]
    const unique = [...new Set(widths)].filter((width) => width > 0).sort((a, b) => a - b)

    const variants: ImageVariant[] = []
    for (const width of unique) {
      const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return null
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, width, height)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.82),
      )
      if (!blob) return null
      variants.push({ width, blob })
    }

    return { variants, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}
