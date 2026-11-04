import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Badge } from '../components/ui'
import { Loader2, Smartphone, Tablet, Monitor, RefreshCw } from 'lucide-react'

/* Live preview panel (cms-projects-spec.md §7.4).

The admin owns the preview flow:
1. `POST /api/admin/preview-token { slug }` → `{ token, url }`.
2. Fetch `url` (the public API with the preview token) to get the draft project.
3. `postMessage({ type: 'cms-preview', project })` to the iframe.
4. On save (debounced ~600ms), re-post the updated project.

The iframe loads the site's `/work/:slug?cms-preview=1` page, which is
expected to listen for `cms-preview` messages and render the draft. That
listener is site-side wiring (not in this repo) — until it exists the iframe
shows the published page or a blank state, but the postMessage plumbing is
correct and origin-checked.
*/

export type Device = 'mobile' | 'tablet' | 'desktop'

export function CustomPreviewPanel({
  siteOrigin,
  slug,
  projectData,
  isActive,
  onError,
}: {
  siteOrigin?: string
  slug?: string
  projectData?: Record<string, unknown> | null
  isActive: boolean
  onError?: (message: string) => void
}) {
  const [device, setDevice] = useState<Device>('desktop')
  const [loading, setLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const postTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const iframeSrc = siteOrigin && slug
    ? `${siteOrigin.replace(/\/+$/, '')}/work/${encodeURIComponent(slug)}?cms-preview=1`
    : ''

  const postProject = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentWindow || !projectData || !siteOrigin) return
    try {
      const url = new URL(iframe.src, siteOrigin)
      if (url.origin !== siteOrigin.replace(/\/+$/, '')) return
      iframe.contentWindow.postMessage(
        { type: 'cms-preview', project: projectData },
        url.origin,
      )
    } catch {
      onError?.('Could not post the project to the preview iframe.')
    }
  }, [projectData, siteOrigin, onError])

  useEffect(() => {
    if (!isActive || !projectData) return
    if (postTimer.current) clearTimeout(postTimer.current)
    postTimer.current = setTimeout(() => {
      postProject()
    }, 600)
    return () => {
      if (postTimer.current) clearTimeout(postTimer.current)
    }
  }, [projectData, isActive, postProject])

  useEffect(() => {
    if (isActive && projectData) {
      const t = setTimeout(postProject, 300)
      return () => clearTimeout(t)
    }
  }, [isActive, projectData, postProject])

  const devices = {
    mobile: { label: 'Mobile', icon: Smartphone, width: '390px' as const },
    tablet: { label: 'Tablet', icon: Tablet, width: '768px' as const },
    desktop: { label: 'Desktop', icon: Monitor, width: '100%' as const },
  }

  const dims = devices[device]

  return (
    <div className="flex flex-col gap-4 rounded-card-lg border border-obsidian/10 bg-fog/60 p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge>Preview</Badge>
          {siteOrigin && (
            <span className="text-xs text-obsidian/50">{siteOrigin.replace(/\/+$/, '')}</span>
          )}
        </div>
        <div className="flex gap-1">
          {(
            Object.keys(devices) as Device[]
          ).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={device === d ? 'secondary' : 'outline'}
              icon={devices[d].icon}
              onClick={() => setDevice(d)}
              title={dims.label}
            />
          ))}
        </div>
      </div>

      <div
        className="relative bg-white rounded-panel overflow-hidden shadow-soft border border-obsidian/10"
        style={{ width: dims.width }}
      >
        {!siteOrigin || !slug ? (
          <div className="flex h-48 items-center justify-center text-sm text-obsidian/40">
            Configure the site origin to enable preview.
          </div>
        ) : !isActive ? (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-obsidian/40">
            <Loader2 className="h-4 w-4 animate-spin text-obsidian/30" />
            Activate preview to load the project page.
          </div>
        ) : loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-obsidian/30" />
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="block w-full h-96 border-0"
            title={`Preview: /work/${slug}`}
            sandbox="allow-same-origin allow-scripts allow-forms"
            onLoad={() => {
              setLoading(false)
              postProject()
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-obsidian/40">
        <span>{dims.label} — {slug || '—'}</span>
        <div className="flex items-center gap-2">
          {isActive && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-obsidian/10 bg-white px-2 py-1 text-[11px] font-medium text-obsidian hover:bg-fog"
              onClick={() => {
                setLoading(true)
                postProject()
                setTimeout(() => setLoading(false), 1000)
              }}
              title="Re-send the project to the preview iframe"
            >
              <RefreshCw size={12} strokeWidth={1.7} />
              Refresh
            </button>
          )}
          <span className="text-obsidian/30">·</span>
          <span>Debounced ~600ms</span>
        </div>
      </div>
    </div>
  )
}
